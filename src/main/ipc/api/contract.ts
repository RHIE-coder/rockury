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

  if (spec.kind !== 'graphql') {
    // gRPC·SOAP 은 완전 판정 대상이지만 아직 안 만들었다. 관측으로 내려가지 않고
    // "안 만들었다"고 그대로 말한다 — 없는 확신을 주지 않는다.
    return driftUnavailable(
      'not-implemented',
      `${spec.kind} 의 완전 판정은 아직 만들지 않았습니다 (GraphQL 부터 구현했습니다).`,
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

export function registerApiContractIpc(): void {
  ipcMain.handle('api:runDrift', async (_e, input: RunDriftInput): Promise<DriftResult> => {
    const spec = getSpec(input.specId)
    if (!spec) throw new Error(`명세 "${input.specId}" 가 없습니다.`)
    const env = getEnvironment(input.environmentId)
    if (!env) throw new Error('환경을 먼저 고르세요 — 어디를 볼지 정해지지 않았습니다.')

    const result = supportsCompleteDrift(spec.kind)
      ? await completeDrift(spec.id, env.id)
      : driftFromObservations({
          spec,
          runs: observationRuns(spec.id, env.id),
          environmentName: env.name
        })

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
