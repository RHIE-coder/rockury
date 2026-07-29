import { ipcMain } from 'electron'
import { getSpec, versionMatchingDraft } from '../../store/apiSpecs'
import {
  appendRun,
  deleteEnvironment,
  duplicateEnvironment,
  getEnvironment,
  getRun,
  listEnvironments,
  listRuns,
  pruneRuns,
  RUN_KEEP,
  saveEnvironment,
  type ListRunsFilter,
  type SaveEnvironmentInput
} from '../../store/apiOps'
import { sendHttp } from '../../api/httpSend'
import { composeRequest } from '../../../shared/api/compose'
import { redactHeaders, redactText, secretValues } from '../../../shared/api/redact'
import { nodeFunctionEnv } from '../../../shared/api/nodeFunctionEnv'
import type { RunRecord } from '../../../shared/api/types'

export interface SendRequestInput {
  specId: string
  requestName: string
  environmentId: string
  call: Record<string, string>
  baseVersion?: string | null
  /**
   * 화면이 만든 취소 손잡이. **응답을 기다리기 전에 화면이 이미 알고 있어야** 취소 버튼을
   * 누를 수 있다 — 메인이 만들어 응답으로 주면 그때는 이미 끝난 뒤다(스트림 세션 id 를
   * 화면이 만드는 것과 같은 이유).
   */
  sendId?: string
}

export interface SendRequestResult {
  run: RunRecord
  /** 보관 상한으로 지워진 건수. 0 이 아니면 화면이 알린다(조용한 소실 금지). */
  pruned: number
}

/**
 * 운영부 IPC — 환경과 실행.
 *
 * 전송 경로가 여기 있는 이유: 조립을 **두 번** 한다.
 *   ① 실제로 보낼 것(비밀 실값)   ② 기록에 남길 것(비밀 가림)
 * 저장한 뒤 가리는 게 아니라 **가린 뒤 저장한다** — 저장소에 실값이 한 번도 안 들어간다.
 */
/**
 * 도는 중인 전송의 취소 손잡이. 화면이 준 id 로 찾는다.
 * 끝나면 반드시 지운다 — 안 지우면 취소 못 할 실행이 맵에 쌓인다.
 */
const inFlight = new Map<string, AbortController>()

export function registerApiOpsIpc(): void {
  ipcMain.handle('api:listEnvironments', (_e, specId: string) => listEnvironments(specId))
  ipcMain.handle('api:saveEnvironment', (_e, input: SaveEnvironmentInput) => saveEnvironment(input))
  ipcMain.handle('api:duplicateEnvironment', (_e, id: string, name: string) =>
    duplicateEnvironment(id, name)
  )
  ipcMain.handle('api:deleteEnvironment', (_e, id: string) => deleteEnvironment(id))

  ipcMain.handle('api:listRuns', (_e, specId: string, filter?: ListRunsFilter) =>
    listRuns(specId, filter ?? {})
  )
  // 상세는 **본문까지** 읽는다(스트림 세션의 메시지 목록이 여기서 나온다). 목록 1,000건을
  // 읽어 `.find()` 하던 예전 방식은 같은 자리에서 메시지를 전부 파싱해 초 단위로 멈췄다.
  ipcMain.handle('api:getRun', (_e, specId: string, runId: string) => getRun(specId, runId))

  /**
   * 도는 중인 전송을 끊는다 (spec send.execute AC-3).
   * **취소도 기록에 남는다** — 실패와 다른 갈래(`취소`)로 갈려서, "안 보낸 것"과
   * "보내다 말았다"가 뭉치지 않는다. 그 기록은 `api:send` 가 정상 반환하며 남긴다.
   */
  ipcMain.handle('api:cancelSend', (_e, sendId: string): boolean => {
    const c = inFlight.get(sendId)
    if (!c) return false
    c.abort()
    return true
  })

  ipcMain.handle('api:send', async (_e, input: SendRequestInput): Promise<SendRequestResult> => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const request = spec.requests.find((r) => r.name === input.requestName)
    if (!request)
      throw new Error(
        `요청 "${input.requestName}" 이(가) 없습니다 — 이 명세의 요청: ${spec.requests.map((r) => r.name).join(', ') || '(없음)'}`
      )
    const env = getEnvironment(input.environmentId)
    if (!env) throw new Error('환경을 먼저 고르세요 — 어디로 보낼지 정해지지 않았습니다.')

    const base = { kind: spec.kind, request, env, call: input.call, functions: nodeFunctionEnv }
    const real = composeRequest(base)
    const masked = composeRequest({ ...base, maskSecrets: true })
    if (!real.canSend) {
      // 화면이 이미 막고 있지만, 재실행·에이전트 등 다른 경로도 같은 관문을 지나야 한다.
      // 문구는 **가린 쪽**을 쓴다 — 내장 함수 오류가 받은 인자를 그대로 인용하기 때문이다.
      throw new Error(masked.blocking.map((b) => `${b.where}: ${b.message}`).join('\n'))
    }

    const secrets = secretValues(env.values)
    const controller = new AbortController()
    if (input.sendId) inFlight.set(input.sendId, controller)
    let result: Awaited<ReturnType<typeof sendHttp>>
    try {
      result = await sendHttp({
        method: real.method,
        url: real.url,
        headers: real.headers,
        body: real.body,
        signal: controller.signal
      })
    } finally {
      if (input.sendId) inFlight.delete(input.sendId)
    }

    // 응답에도 비밀이 되돌아올 수 있다(키를 에코하는 서버·오류 메시지에 실린 인증 헤더).
    // 요청만 가리고 응답을 그대로 저장하면 여기서 샌다 — e2e 로 실측해 잡은 자리다.
    const response = result.response
      ? {
          ...result.response,
          headers: redactHeaders(result.response.headers, secrets),
          body: redactText(result.response.body, secrets)
        }
      : null

    const run = appendRun({
      specId: spec.id,
      requestName: request.name,
      environmentId: env.id,
      environmentName: env.name,
      // 호출자가 안 정했으면 Draft 가 어느 버전과 똑같은지로 정한다 — 최신 번호를
      // 그냥 붙이면 컷 이후 고친 Draft 의 관측이 그 버전 것으로 둔갑한다.
      baseVersion: input.baseVersion ?? versionMatchingDraft(spec.id),
      shape: request.shape,
      // 파라미터도 **가린 뒤 저장한다** — 사용자가 환경 비밀 값을 손으로 붙여넣었을 수 있다.
      // 그러면 다시 실행에서 그 자리를 못 되살리는데, 새는 것보다 낫다(화면이 이유를 말한다).
      call: Object.fromEntries(
        Object.entries(input.call).map(([k, v]) => [k, redactText(v, secrets)])
      ),
      status: result.status,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      // 가린 조립본을 저장한다 — 저장소·기록·MCP 어디에도 실값이 안 남는다.
      request: { method: masked.method, url: masked.url, headers: masked.headers, body: masked.body },
      response,
      messages: null, // 단발 실행 — 스트림 세션이 아니다("없음"이지 "0건"이 아니다).
      error: result.error ? redactText(result.error, secrets) : null
    })

    return { run, pruned: pruneRuns(spec.id, RUN_KEEP).removed }
  })
}
