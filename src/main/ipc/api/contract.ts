import { ipcMain } from 'electron'
import { getSpec, replaceRequests } from '../../store/apiSpecs'
import { getEnvironment, latestSessionRuns, listRuns } from '../../store/apiOps'

/**
 * 판정에 먹일 관측 목록.
 *
 * 단발은 목록 조회로 충분하지만(본문이 응답 자리에 있다), 스트림·수신은 **메시지 본문**이
 * 관측 내용이라 따로 읽어야 한다 — 목록 조회는 본문을 안 싣는다(그러면 메인이 멈춘다).
 * 요청마다 최신 세션 하나씩만 읽으므로 읽는 양이 요청 수만큼으로 묶인다.
 */
function observationRuns(specId: string, environmentId: string): ReturnType<typeof listRuns> {
  const unary = listRuns(specId, { environmentId, limit: 1000 }).filter((r) => r.shape === 'unary')
  return [...unary, ...latestSessionRuns(specId, environmentId)]
}
import { appendContractLog, latestDrift, listContractLogs } from '../../store/apiContract'
import { introspectGraphql } from '../../api/introspect'
import { reflectGrpc } from '../../api/grpcReflect'
import { methodsOf, resolveMethodPath, rootFieldsFor } from '../../../shared/api/proto'
import { assumedNote, parseGrpcTarget, plaintextSecretBlock } from '../../../shared/api/grpcTarget'
import { redactText, secretValues } from '../../../shared/api/redact'
import { composeRequest } from '../../../shared/api/compose'
import { nodeFunctionEnv } from '../../../shared/api/nodeFunctionEnv'
import { previewAbsorb, type AbsorbPreview } from '../../../shared/api/absorb'
import { rootFieldOf } from '../../../shared/api/graphql'
import {
  driftFromObservations,
  driftFromSchema,
  driftUnavailable,
  summarizeDrift,
  type DriftResult
} from '../../../shared/api/drift'
import { supportsCompleteDrift } from '../../../shared/api/types'

/**
 * 판정 IPC — `docs/spec/api-contract.md`.
 *
 * 등급을 고르는 것이 여기서 제일 중요한 결정이다:
 *   · 서버가 스키마를 뱉는 종류(GraphQL·gRPC·SOAP) → **완전 판정**
 *   · 그 외 → **관측 판정**(쏴 본 것만)
 * 완전 판정을 못 하면 **관측으로 내려가지 않는다** — 사유를 단 빈 결과를 준다.
 */

export interface RunDriftInput {
  specId: string
  environmentId: string
}

async function completeDrift(specId: string, environmentId: string): Promise<DriftResult> {
  const spec = getSpec(specId)!
  const env = getEnvironment(environmentId)!

  if (spec.kind === 'grpc') return await grpcDrift(spec, env)

  if (spec.kind !== 'graphql') {
    // SOAP 은 완전 판정 대상이지만 아직 안 만들었다. 관측으로 내려가지 않고
    // "안 만들었다"고 그대로 말한다 — 없는 확신을 주지 않는다.
    // 어느 종류가 됐는지를 여기서 손으로 세지 않는다 — 그 목록은 곧 낡는다.
    return driftUnavailable(
      'not-implemented',
      `이 앱은 아직 ${spec.kind} 의 완전 판정을 만들지 않았습니다.`,
      env.name
    )
  }

  // 접속 주소·인증 헤더는 요청 하나를 조립해 얻는다 — 환경 값 치환을 한 곳에서만 하기 위해서.
  const sample = spec.requests[0]
  const headers = sample
    ? composeRequest({ kind: spec.kind, request: sample, env, call: {}, functions: nodeFunctionEnv }).headers
    : {}
  const url = `${env.baseUrl.replace(/\/+$/, '')}${sample?.request.path ?? ''}` || env.baseUrl

  const outcome = await introspectGraphql(url, headers)
  if (!outcome.ok) return driftUnavailable(outcome.reason, outcome.message, env.name)

  const rootOf: Record<string, string | null> = {}
  for (const r of spec.requests) rootOf[r.name] = rootFieldOf(r.request.graphqlQuery ?? '')
  return driftFromSchema({
    spec,
    schema: outcome.schema,
    environmentName: env.name,
    rootOf,
    // 스트리밍 요청(subscription)은 서버 스키마에 루트가 없어 대조 대상이 아니다 —
    // 세션 관측이 있었는지만 가려 커버리지에 정직하게 싣는다.
    runs: observationRuns(spec.id, env.id)
  })
}

/**
 * gRPC 완전 판정 — 서버에게 정의를 받아(reflection) 선언과 대조한다.
 *
 * GraphQL 과 두 가지가 다르다:
 *   ① **스트리밍까지 대조한다.** reflection 은 스트리밍 메서드의 응답 메시지도 그대로
 *      설명해 준다 — 빼면 서버가 말해 준 것을 안 보는 셈이다.
 *   ② 요청과 서버를 잇는 열쇠가 루트 필드가 아니라 **메서드 경로**(`/패키지.서비스/메서드`)다.
 */
async function grpcDrift(
  spec: NonNullable<ReturnType<typeof getSpec>>,
  env: NonNullable<ReturnType<typeof getEnvironment>>
): Promise<DriftResult> {
  const target = parseGrpcTarget(env.baseUrl)
  // 헤더는 요청 하나를 조립해 얻는다 — 환경 값 치환을 한 곳에서만 하기 위해서.
  const sample = spec.requests[0]
  const headers = sample
    ? composeRequest({ kind: spec.kind, request: sample, env, call: {}, functions: nodeFunctionEnv })
        .headers
    : {}

  // **암호화되는지 모르는 채로 비밀을 보내지 않는다.** 정의를 받아 오는 왕복이 먼저 일어나므로,
  // 여기서 안 막으면 "평문으로 붙었다" 는 안내가 닿을 때는 토큰이 이미 나간 뒤다.
  const block = plaintextSecretBlock(target, headers, secretValues(env.values))
  if (block) return driftUnavailable('connect-failed', block, env.name)

  const outcome = await reflectGrpc(target, headers)
  if (!outcome.ok) {
    // 평문/암호화를 우리가 정한 경우라면 그것도 원인 후보다 — 사유에 붙여 준다.
    // 한 줄로 잇는다: 받는 자리가 개행을 살리지 않아 `\n\n` 은 어차피 한 칸으로 접힌다.
    const note = assumedNote(target)
    return driftUnavailable(
      outcome.reason,
      note ? `${outcome.message} ${note}` : outcome.message,
      env.name
    )
  }

  const methods = methodsOf(outcome.package)
  const known = [...methods.keys()]
  const rootOf: Record<string, string | null> = {}
  for (const r of spec.requests) {
    const path = resolveMethodPath(r.request.grpcMethod ?? '', known)
    // 이름을 못 맞췄거나(모호·오타) **응답 모양을 못 읽었으면** 판정에서 뺀다.
    // 특히 뒤엣것을 안 빼면 "서버 스키마에 없습니다 — 이 요청은 지금 깨집니다" 로 나가는데,
    // 그건 모르는 것을 안다고 말하는 것이다(서버에는 그 메서드가 **있다**).
    rootOf[r.name] = path && methods.get(path)?.response ? path : null
  }

  const wanted = Object.values(rootOf).filter((p): p is string => p !== null)
  return driftFromSchema({
    spec,
    schema: { rootFields: rootFieldsFor(outcome.package, methods, wanted) },
    environmentName: env.name,
    rootOf,
    // 스키마가 스트리밍까지 덮으므로 대조는 스키마로 한다. 관측 기록은 **수신(웹훅)이 있을 때만**
    // 필요하다 — 그 읽기가 세션 메시지 본문까지 끌어오므로(수십 MB) 없을 때는 건드리지 않는다.
    runs: spec.requests.some((r) => r.shape === 'inbound')
      ? observationRuns(spec.id, env.id)
      : []
  })
}

export function registerApiContractIpc(): void {
  ipcMain.handle('api:runDrift', async (_e, input: RunDriftInput): Promise<DriftResult> => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const env = getEnvironment(input.environmentId)
    if (!env) throw new Error('환경을 먼저 고르세요 — 어디를 볼지 정해지지 않았습니다.')

    const raw = supportsCompleteDrift(spec.kind)
      ? await completeDrift(spec.id, env.id)
      : driftFromObservations({
          spec,
          runs: observationRuns(spec.id, env.id),
          environmentName: env.name
        })

    // **사유에서도 아는 비밀을 지운다.** 사유는 서버가 준 글자를 인용하는데(인증 실패 자리가
    // 특히 그렇다), 이 값은 화면에 그려지고 로컬 DB 에 저장되고 MCP 도구로도 나간다.
    const secrets = secretValues(env.values)
    const result: DriftResult = raw.unavailable
      ? { ...raw, unavailable: { ...raw.unavailable, message: redactText(raw.unavailable.message, secrets) } }
      : raw

    appendContractLog({
      specId: spec.id,
      kind: 'drift',
      environmentId: env.id,
      environmentName: env.name,
      grade: result.grade,
      summary: summarizeDrift(result),
      payload: result
    })
    return result
  })

  ipcMain.handle('api:getDrift', (_e, specId: string) => latestDrift(specId) ?? null)
  ipcMain.handle('api:listContractLogs', (_e, specId: string) => listContractLogs(specId))

  /** 미리보기만 만든다 — 수락 전에는 Draft 가 안 바뀐다(spec accept.absorb AC-3). */
  ipcMain.handle(
    'api:previewAbsorb',
    (_e, specId: string, environmentId: string, requestNames: string[]): AbsorbPreview => {
      const spec = getSpec(specId)
      if (!spec) throw new Error(`명세 "${specId}" 가 없습니다.`)
      return previewAbsorb({
        spec,
        runs: listRuns(specId, { environmentId, limit: 1000 }),
        requestNames
      })
    }
  )

  ipcMain.handle(
    'api:acceptAbsorb',
    (_e, specId: string, environmentId: string, requestNames: string[]) => {
      const spec = getSpec(specId)
      if (!spec) throw new Error(`명세 "${specId}" 가 없습니다.`)
      const env = getEnvironment(environmentId)
      const preview = previewAbsorb({
        spec,
        runs: listRuns(specId, { environmentId, limit: 1000 }),
        requestNames
      })
      if (preview.changes.length === 0) return preview

      // 흡수는 **Draft 로만** 들어간다 — 버전 컷은 사람이 따로 한다(spec accept.absorb AC-2).
      replaceRequests(specId, preview.spec.requests)
      appendContractLog({
        specId,
        kind: 'accept',
        environmentId: env?.id ?? null,
        environmentName: env?.name ?? '',
        grade: null,
        summary: `흡수 ${preview.changes.length}건 — ${preview.changes.map((c) => c.path).join(', ')}`,
        payload: preview.changes
      })
      return preview
    }
  )
}
