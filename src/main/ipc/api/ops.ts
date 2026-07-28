import { ipcMain } from 'electron'
import { getSpec, versionMatchingDraft } from '../../store/apiSpecs'
import {
  appendRun,
  deleteEnvironment,
  duplicateEnvironment,
  getEnvironment,
  listEnvironments,
  listRuns,
  pruneRuns,
  saveEnvironment,
  type ListRunsFilter,
  type SaveEnvironmentInput
} from '../../store/apiOps'
import { sendHttp } from '../../api/httpSend'
import { composeRequest } from '../../../shared/api/compose'
import { redactHeaders, redactText, secretValues } from '../../../shared/api/redact'
import { nodeFunctionEnv } from '../../../shared/api/nodeFunctionEnv'
import type { RunRecord } from '../../../shared/api/types'

/** 명세당 실행 기록 보관 상한. 넘치면 오래된 것부터 지우고 **몇 건 지웠는지 알린다**. */
const RUN_KEEP = 500

export interface SendRequestInput {
  specId: string
  requestName: string
  environmentId: string
  call: Record<string, string>
  baseVersion?: string | null
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
  ipcMain.handle('api:getRun', (_e, specId: string, runId: string) =>
    listRuns(specId, { limit: 1000 }).find((r) => r.id === runId) ?? null
  )

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
    if (!real.canSend) {
      // 화면이 이미 막고 있지만, 재실행·에이전트 등 다른 경로도 같은 관문을 지나야 한다.
      throw new Error(real.blocking.map((b) => `${b.where}: ${b.message}`).join('\n'))
    }
    const masked = composeRequest({ ...base, maskSecrets: true })

    const result = await sendHttp({
      method: real.method,
      url: real.url,
      headers: real.headers,
      body: real.body
    })

    // 응답에도 비밀이 되돌아올 수 있다(키를 에코하는 서버·오류 메시지에 실린 인증 헤더).
    // 요청만 가리고 응답을 그대로 저장하면 여기서 샌다 — e2e 로 실측해 잡은 자리다.
    const secrets = secretValues(env.values)
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
      status: result.status,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      // 가린 조립본을 저장한다 — 저장소·기록·MCP 어디에도 실값이 안 남는다.
      request: { method: masked.method, url: masked.url, headers: masked.headers, body: masked.body },
      response,
      error: result.error ? redactText(result.error, secrets) : null
    })

    return { run, pruned: pruneRuns(spec.id, RUN_KEEP).removed }
  })
}
