import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ToolDef } from './tools'
import {
  assertRequestsConsistent,
  createSpec,
  getSpec,
  listSpecs,
  listVersions,
  replaceRequests,
  updateSpec
} from '../store/apiSpecs'
import { listRuns } from '../store/apiOps'
import { latestDrift, listContractLogs } from '../store/apiContract'
import { splitFindings, summarizeDrift, type DriftResult } from '../../shared/api/drift'
import { applyPatch, PATCH_OP_NAMES, type PatchOp } from '../../shared/api/patch'
import { shapeOfBody } from '../../shared/api/observed'
import { describeSignature } from '../../shared/api/signature'
import { INTERFACE_KINDS, INTERFACE_META, type SpecDef } from '../../shared/api/types'

/**
 * API 서비스의 MCP 도구 — `docs/spec/api-mcp.md`.
 *
 * **설계면만 연다**: 만들기·고치기 ○ / 지우기·실행 × (spec §4-③).
 *  · 실행 도구가 없는 이유 — AI 는 터미널에서 더 잘 쏜다. 중간에 끼면 요청 id·환경 id 를
 *    맞춰야 해서 오히려 어려워지고, 실행이 없으면 자격증명 문제 자체가 생기지 않는다.
 *  · 버전 컷 도구가 없는 이유 — 깨지는 변경 승인 게이트가 컷에 붙어 있고 그 승인은 사람 몫이다.
 *    (DB 서비스는 `create_version` 을 열었다 — 여기서 갈린다.)
 *
 * 도구 이름은 전부 `api_` 접두어다. DB 가 `create_version`·`list_versions`·`get_version` 을
 * 접두어 없이 쓰고 있어 **실제로 겹치기 때문**이다(spec api-mcp § naming.prefix).
 *
 * 이 파일이 `tools.ts` 밖에 있는 이유: 공용 파일 편집을 두 줄로 줄여 병렬 개발 충돌을 없앤다.
 */

// ── 열린 앱 화면 따라오게 하기 ────────────────────────────────────────────
// 쓰기가 **성공했을 때만** 발행한다(spec tools.write AC-8). electron 을 여기서 import 하지
// 않는 이유는 기존 tools.ts 와 같다 — 테스트가 이 모듈을 그냥 불러올 수 있어야 한다.
// 실제 창 전파는 `ipc/api/index.ts` 가 등록 시점에 주입한다(공용 main/index.ts 미변경).

export interface ApiChangedEvent {
  domain: 'specs' | 'requests' | 'versions'
  specId: string
}

let notifyApiChanged: (e: ApiChangedEvent) => void = () => {}

export function setApiChangeNotifier(fn: (e: ApiChangedEvent) => void): void {
  notifyApiChanged = fn
}

// ── 입력 검증 ─────────────────────────────────────────────────────────────
// 검증은 SDK 프로토콜 층이 아니라 핸들러 안에서 한다 — 실패가 프로토콜 오류가 아니라
// isError + 해결 안내로 나가야 하기 때문(spec tools.write AC-6).

const paramSchema = z.looseObject({
  name: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  defaultValue: z.string().optional(),
  description: z.string().optional(),
  enumValues: z.array(z.string()).optional()
})

const fieldSchema: z.ZodType = z.lazy(() =>
  z.looseObject({
    name: z.string(),
    type: z.string(),
    requiredness: z.string().optional(),
    enumValues: z.array(z.string()).optional(),
    fields: z.array(fieldSchema).optional()
  })
)

const responseSchema = z.looseObject({ status: z.string(), fields: z.array(fieldSchema).default([]) })

const requestSchema = z.looseObject({
  name: z.string(),
  folder: z.string().optional(),
  shape: z.string().optional(),
  params: z.array(paramSchema).optional(),
  request: z.looseObject({}).optional(),
  responses: z.array(responseSchema).optional(),
  docs: z.string().optional()
})

const KIND_GUIDE = INTERFACE_META.map((m) => `${m.id} (${m.label})`).join(' · ')

function invalid(prefix: string, error: z.ZodError): never {
  const first = error.issues[0]
  throw new Error(`${prefix} — ${first.path.join('.') || '입력'}: ${first.message}`)
}

function requireSpecDef(specId: unknown): SpecDef {
  const id = String(specId ?? '')
  const s = getSpec(id)
  if (!s) {
    const known = listSpecs().map((x) => x.id)
    throw new Error(
      `명세 "${id}" 가 없습니다 — api_list_specs 로 확인하세요. 있는 것: ${known.join(', ') || '(없음)'}`
    )
  }
  return s
}

/** 정규화 — 도구 입력은 느슨하게 받고 도메인 기본값을 채운다. */
function normalizeRequests(input: z.infer<typeof requestSchema>[]): SpecDef['requests'] {
  return input.map((r) => ({
    id: `mcp_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    name: r.name,
    folder: r.folder ?? '',
    shape: (r.shape ?? 'unary') as SpecDef['requests'][number]['shape'],
    params: (r.params ?? []).map((p) => ({
      ...p,
      required: p.required ?? false
    })) as SpecDef['requests'][number]['params'],
    request: (r.request ?? {}) as SpecDef['requests'][number]['request'],
    responses: (r.responses ?? []).map((res) => ({
      status: res.status,
      fields: normalizeFields(res.fields as unknown[])
    })) as SpecDef['requests'][number]['responses'],
    docs: r.docs ?? ''
  }))
}

/** 필수여부를 안 적으면 `unknown`(모름)이다 — **모름을 안전으로 치지 않기 위해서**다(spec §4-①). */
function normalizeFields(fields: unknown[]): SpecDef['requests'][number]['responses'][number]['fields'] {
  return (fields as Record<string, unknown>[]).map((f) => ({
    name: String(f.name),
    type: String(f.type) as never,
    requiredness: (f.requiredness ?? 'unknown') as never,
    ...(f.enumValues ? { enumValues: f.enumValues as string[] } : {}),
    ...(f.fields ? { fields: normalizeFields(f.fields as unknown[]) } : {})
  }))
}

function summarize(spec: SpecDef): Record<string, unknown> {
  return {
    spec: { id: spec.id, name: spec.name, kind: spec.kind },
    requestCount: spec.requests.length,
    requests: spec.requests.map((r) => ({
      name: r.name,
      shape: r.shape,
      params: r.params.length,
      responses: r.responses.map((x) => x.status)
    }))
  }
}

// ── 도구 ──────────────────────────────────────────────────────────────────

export const API_TOOL_DEFS: ToolDef[] = [
  {
    name: 'api_list_specs',
    description:
      'Rockury 의 API 명세(Spec) 목록 — id·이름·설명·인터페이스 종류·요청 수·최신 버전. 다른 api_* 도구의 specId 는 여기서 얻는다.',
    inputSchema: {},
    handler: () => listSpecs()
  },
  {
    name: 'api_get_spec',
    description:
      'API 명세 하나를 한 덩어리로 반환한다 — 요청 목록 + 각 요청의 파라미터 시그니처(이름·타입·필수·기본값·설명) + 요청/응답 스키마 + 사람이 쓴 문서. **API 를 구현하거나 점검할 때 읽는 기본 입력**이다. requests 로 필요한 요청만 추릴 수 있다.',
    inputSchema: {
      specId: z.string().describe('명세 id (api_list_specs 로 확인)'),
      requests: z.array(z.string()).optional().describe('읽을 요청 이름만 추린다(생략 시 전체)')
    },
    handler: ({ specId, requests }) => {
      const spec = requireSpecDef(specId)
      const want = Array.isArray(requests) ? requests.map(String) : []
      const chosen =
        want.length === 0 ? spec.requests : spec.requests.filter((r) => want.includes(r.name))
      if (want.length > 0) {
        // 오타로 조용히 빈 결과를 받는 것보다 이름이 틀렸다고 알려주는 편이 낫다.
        const missing = want.filter((n) => !spec.requests.some((r) => r.name === n))
        if (missing.length > 0)
          throw new Error(
            `명세 "${spec.id}" 에 없는 요청: ${missing.join(', ')} — 이 명세의 요청: ${spec.requests.map((r) => r.name).join(', ') || '(없음)'}`
          )
      }
      return {
        spec: { id: spec.id, name: spec.name, description: spec.description, kind: spec.kind },
        requests: chosen.map((r) => ({
          name: r.name,
          folder: r.folder,
          shape: r.shape,
          signature: describeSignature(r.params),
          request: r.request,
          responses: r.responses,
          docs: r.docs
        }))
      }
    }
  },
  {
    name: 'api_get_runs',
    description:
      '사람이 앱에서 실제로 쏴 보고 받은 기록을 요약해 준다 — 요청·환경·상태·소요·시각과 **응답의 모양**(필드 이름/타입). 코드를 읽어서는 알 수 없는 "실제로 뭐가 왔는가"가 여기 있다. 응답 **본문은 주지 않는다**(토큰·개인정보가 섞일 수 있다).',
    inputSchema: {
      specId: z.string().describe('명세 id (api_list_specs 로 확인)'),
      requestName: z.string().optional().describe('이 요청의 기록만'),
      limit: z.number().optional().describe('최대 건수(기본 50)')
    },
    handler: ({ specId, requestName, limit }) => {
      const spec = requireSpecDef(specId)
      const runs = listRuns(spec.id, {
        requestName: requestName === undefined ? undefined : String(requestName),
        limit: Math.min(Number(limit ?? 50) || 50, 200)
      })
      return runs.map((r) => {
        const parsed = r.response ? shapeOfBody(r.response.body) : null
        const stream = r.shape !== 'unary'
        return {
          requestName: r.requestName,
          environment: r.environmentName,
          baseVersion: r.baseVersion,
          // **어떤 관측이었는지 밝힌다.** 안 밝히면 스트림 세션이 "성공했는데 응답 모양을
          // 못 읽은 단발 실행" 처럼 보인다 — 있지도 않은 응답을 찾게 만드는 셈이다.
          interaction: r.shape,
          status: r.status,
          httpStatus: r.httpStatus,
          durationMs: r.durationMs,
          observedAt: r.createdAt,
          // 모양까지만. 본문은 사람이 앱에서 본다(spec api-mcp tools.read AC-3).
          responseShape: parsed?.json ? parsed.shape : null,
          responseIsJson: parsed?.json ?? null,
          // 스트림 세션의 관측 내용은 메시지 목록이다. 본문은 안 주고 **건수만** 준다 —
          // 응답 본문을 안 주는 것과 같은 선이고, 판정 규칙이 아직 없다는 사실도 함께 적는다.
          messageCount: stream ? (r.messageCount ?? 0) : null,
          note: stream
            ? '스트림·수신 세션 관측 — 메시지 목록이 관측 내용이고, 아직 대조 규칙이 없어 판정에서 unjudged 로 빠집니다. 본문은 앱에서 봅니다.'
            : undefined
        }
      })
    }
  },
  {
    name: 'api_get_drift',
    description:
      '가장 최근 판정 결과 — 선언한 명세와 실제 서버가 어긋난 곳. **등급(완전/관측)과 커버리지가 반드시 함께 온다**: 관측 판정은 실제로 쏴 본 요청만 아는 것이라 "이상 없음"이 "전부 확인됨"을 뜻하지 않는다. 고칠 목록(코드 쪽)과 흡수 후보(명세 쪽)가 갈라져 온다.',
    inputSchema: {
      specId: z.string().describe('명세 id (api_list_specs 로 확인)'),
      history: z.boolean().optional().describe('true 면 판정·흡수 이력도 함께 준다')
    },
    handler: ({ specId, history }) => {
      const spec = requireSpecDef(specId)
      const log = latestDrift(spec.id)
      if (!log) {
        return {
          ran: false,
          // "어긋남 없음" 이 아니라 "아직 안 돌렸음" 이다 — 둘을 섞으면 AI 가 오해한다.
          message: '아직 판정을 돌리지 않았습니다 — 사람이 앱에서 Contract › Drift 를 실행해야 합니다.'
        }
      }
      const result = log.payload as DriftResult
      const { absorb, report } = splitFindings(result)
      return {
        ran: true,
        ranAt: log.createdAt,
        environment: log.environmentName,
        grade: result.grade,
        gradeMeans:
          result.grade === 'complete'
            ? '서버 스키마 전량 대조'
            : '실제로 쏴 본 것만 — 미관측은 확인된 것이 아니다',
        unavailable: result.unavailable,
        coverage: result.coverage,
        skippedUnknown: result.skippedUnknown,
        unstable: result.unstable,
        summary: summarizeDrift(result),
        /** 코드를 고쳐야 하는 것 — AI 가 읽고 구현을 고칠 입력. */
        toFixInCode: report,
        /** 명세로 받아들일 수 있는 것 — 사람이 앱에서 수락한다. */
        toAbsorbIntoSpec: absorb,
        ...(history ? { logs: listContractLogs(spec.id, 30).map((l) => ({ kind: l.kind, at: l.createdAt, summary: l.summary })) } : {})
      }
    }
  },
  {
    name: 'api_list_versions',
    description:
      '명세의 버전(불변 스냅샷) 이력 — 번호·메모·잠금·시각 (최신순, 스냅샷 본문 제외). 버전 컷은 사람이 앱에서 한다.',
    inputSchema: { specId: z.string().describe('명세 id (api_list_specs 로 확인)') },
    handler: ({ specId }) => {
      const spec = requireSpecDef(specId)
      return listVersions(spec.id).map((v) => ({
        number: v.number,
        note: v.note,
        locked: v.locked,
        createdAt: v.createdAt
      }))
    }
  },

  // ── 쓰기 — Draft 까지만. 성공했을 때만 열린 화면에 알린다. ──
  {
    name: 'api_create_spec',
    description: `새 API 명세를 만든다 — 이름·인터페이스 종류·설명. 종류는 생성 후 바꿀 수 없으므로, 사용자가 말하지 않았으면 임의로 고르지 말고 물어본 뒤 호출할 것. 종류: ${KIND_GUIDE}`,
    inputSchema: {
      name: z.string().describe('명세 이름 (id 는 슬러그로 자동 생성)'),
      kind: z.string().optional().describe(`인터페이스 종류: ${INTERFACE_KINDS.join(' | ')}`),
      description: z.string().optional()
    },
    handler: ({ name, kind, description }) => {
      if (kind === undefined || String(kind).trim() === '') {
        throw new Error(
          `인터페이스 종류를 정하지 않았습니다 — 임의로 고르지 말고 사용자에게 물어보세요. 선택지: ${KIND_GUIDE}`
        )
      }
      const created = createSpec({
        name: String(name ?? ''),
        kind: String(kind),
        description: description === undefined ? undefined : String(description)
      })
      notifyApiChanged({ domain: 'specs', specId: created.id })
      return created
    }
  },
  {
    name: 'api_update_spec',
    description:
      '명세의 이름·설명을 고친다. 인터페이스 종류는 고정 속성이라 입력 표면에 없다(바꾸려면 새 명세를 만든다).',
    inputSchema: {
      specId: z.string(),
      name: z.string().optional(),
      description: z.string().optional()
    },
    handler: ({ specId, name, description }) => {
      const spec = requireSpecDef(specId)
      const out = updateSpec(spec.id, {
        name: name === undefined ? spec.name : String(name),
        description: description === undefined ? spec.description : String(description)
      })
      notifyApiChanged({ domain: 'specs', specId: spec.id })
      return out
    }
  },
  {
    name: 'api_set_spec',
    description:
      '명세의 Draft 요청 목록을 통째로 반영한다(빠진 요청은 삭제). **새 명세를 처음 채우거나 전체를 갈아엎을 때만** 쓰고, 일부 수정은 api_patch_spec 을 쓴다 — 전체 왕복은 크고 그 과정에서 오타가 섞인다.',
    inputSchema: {
      specId: z.string(),
      requests: z.array(requestSchema).describe('요청 전량. 여기 없는 기존 요청은 삭제된다.')
    },
    handler: ({ specId, requests }) => {
      const spec = requireSpecDef(specId)
      const parsed = z.array(requestSchema).safeParse(requests)
      if (!parsed.success) invalid('요청 목록의 모양이 맞지 않습니다', parsed.error)

      const normalized = normalizeRequests(parsed.data)
      assertRequestsConsistent(spec.kind, normalized)
      replaceRequests(spec.id, normalized)
      notifyApiChanged({ domain: 'requests', specId: spec.id })
      return summarize({ ...spec, requests: normalized })
    }
  },
  {
    name: 'api_patch_spec',
    description: `명세를 부분 수정한다 — 연산을 순서대로 원자 적용(하나라도 실패하면 전부 미반영). 조준은 이름으로 하므로 내부 id 를 먼저 읽을 필요가 없다. 연산: ${PATCH_OP_NAMES.join(' · ')}`,
    inputSchema: {
      specId: z.string(),
      operations: z.array(z.looseObject({ op: z.string() })).describe('연산 목록 (순서대로 적용)')
    },
    handler: ({ specId, operations }) => {
      const spec = requireSpecDef(specId)
      const ops = (Array.isArray(operations) ? operations : []) as PatchOp[]
      if (ops.length === 0) throw new Error(`연산이 비어 있습니다 — 허용: ${PATCH_OP_NAMES.join(', ')}`)

      const { spec: next, changes } = applyPatch(spec, ops)
      assertRequestsConsistent(spec.kind, next.requests)
      replaceRequests(spec.id, next.requests)
      notifyApiChanged({ domain: 'requests', specId: spec.id })
      return { ...summarize(next), changes }
    }
  }
]

export const API_TOOL_NAMES = API_TOOL_DEFS.map((t) => t.name)
