import { shapeOfBody } from './observed'
import type { FieldDef, RunRecord, SpecDef } from './types'

/**
 * 판정 — `docs/spec/api-contract.md`.
 *
 * 이 앱이 Swagger(선언만 봄)·Postman(실제만 봄)과 갈리는 자리다. 그런데 갈리는 값어치는
 * "대조한다"가 아니라 **모르는 것을 안다고 말하지 않는다**에 있다:
 *
 *   · 안 쏴 본 요청은 일치가 아니라 **미관측**이고, 이름까지 남긴다
 *   · 필수여부 `모름` 은 판정에서 빠지고 **몇 개 뺐는지** 결과에 실린다
 *   · JSON 이 아니어서 모양을 못 뽑은 것도 통과가 아니라 **판정 불가**
 *   · 완전 판정이 안 되면 관측 판정으로 **조용히 내려가지 않는다**
 *
 * 그래서 `coverage` 는 선택 필드가 아니다 — 커버리지 없는 결과를 만들 수 없게 타입으로 박았다.
 * 판정 기준은 언제나 **"이 프로젝트가 선언한 것"** 하나다. 업계 표준 준수는 판정하지 않는다.
 */

export type DriftGrade = 'complete' | 'observed'

export type UnavailableReason = 'feature-off' | 'no-permission' | 'connect-failed' | 'not-implemented'

export const UNAVAILABLE_LABEL: Record<UnavailableReason, string> = {
  'feature-off': '서버가 스키마 공개 기능을 꺼 두었습니다',
  'no-permission': '스키마를 읽을 권한이 없습니다',
  'connect-failed': '서버에 붙지 못했습니다',
  'not-implemented': '이 인터페이스의 완전 판정은 아직 만들지 않았습니다'
}

export type FindingKind =
  /** 서버에 있는데 명세엔 없다 — 명세가 뒤처졌다(낮음, 흡수하면 된다). */
  | 'server-only'
  /** 명세에 있는데 실제엔 없다 — 내 요청이 깨진다(높음). */
  | 'spec-only'
  /** 양쪽 있는데 다르다 — 타입·모양 변경(최고). */
  | 'different'

export interface DriftFinding {
  kind: FindingKind
  /** `요청.상태.필드경로` */
  path: string
  detail: string
  declared?: string
  actual?: string
}

export interface DriftCoverage {
  total: number
  observed: number
  /** 아직 한 번도 안 쏴 본 요청 이름. 이 목록이 비어야만 "전부 관측됨"이다. */
  unobserved: string[]
  /** 관측은 했지만 JSON 이 아니라 모양을 못 뽑은 요청. 통과가 아니다. */
  unparsable: string[]
}

export interface DriftResult {
  grade: DriftGrade
  /** null 이면 판정이 실제로 돌았다. 값이 있으면 **결과가 없다**(관측으로 대체하지 않는다). */
  unavailable: { reason: UnavailableReason; message: string } | null
  environmentName: string
  baseVersion: string | null
  coverage: DriftCoverage
  findings: DriftFinding[]
  /** 필수여부 `모름` 때문에 판정에서 뺀 필드 수. */
  skippedUnknown: number
  /** 과거 관측과 응답 모양이 달랐던 요청 — 서버가 도중에 바뀌었을 수 있다. */
  unstable: string[]
}

export interface ObservationInput {
  spec: SpecDef
  runs: readonly RunRecord[]
  environmentName: string
  /** 이 버전 기준의 관측만 본다. 없으면 버전을 안 가린다(Draft 관측 포함). */
  baseVersion?: string | null
}

// ── 필드 대조 ─────────────────────────────────────────────────────────────

interface Ctx {
  findings: DriftFinding[]
  skippedUnknown: number
}

function compareFields(ctx: Ctx, base: string, declared: FieldDef[], actual: FieldDef[]): void {
  const declaredBy = new Map(declared.map((d) => [d.name, d]))
  const actualBy = new Map(actual.map((a) => [a.name, a]))

  for (const a of actual) {
    const path = `${base}.${a.name}`
    const d = declaredBy.get(a.name)
    if (!d) {
      ctx.findings.push({
        kind: 'server-only',
        path,
        detail: `응답에 '${a.name}' 이(가) 있는데 명세엔 없습니다 (${a.type}).`,
        actual: a.type
      })
      continue
    }
    // `null` 은 값이 없다는 뜻이지 타입이 바뀐 게 아니다 — 필수여부로 따진다.
    if (a.type === 'null') {
      if (d.requiredness === 'unknown') ctx.skippedUnknown += 1
      else if (d.requiredness === 'required') {
        ctx.findings.push({
          kind: 'different',
          path,
          detail: `필수라고 선언했는데 응답에서 null 이었습니다.`,
          declared: d.type,
          actual: 'null'
        })
      }
      continue
    }
    if (d.type !== a.type) {
      ctx.findings.push({
        kind: 'different',
        path,
        detail: `타입이 다릅니다 — 선언 ${d.type} / 실제 ${a.type}.`,
        declared: d.type,
        actual: a.type
      })
      continue
    }
    compareFields(ctx, path, d.fields ?? [], a.fields ?? [])
  }

  for (const d of declared) {
    if (actualBy.has(d.name)) continue
    const path = `${base}.${d.name}`
    // 모르는 것을 어긋남으로도, 안전으로도 세지 않는다 — 뺐다는 사실만 남긴다.
    if (d.requiredness === 'unknown') {
      ctx.skippedUnknown += 1
      continue
    }
    // 없을 수 있다고 선언한 값이 이번 응답에 없는 것은 정상이다.
    if (d.requiredness === 'nullable') continue
    ctx.findings.push({
      kind: 'spec-only',
      path,
      detail: `명세에 필수로 있는 '${d.name}' 이(가) 응답에 없습니다.`,
      declared: d.type
    })
  }
}

// ── 관측 판정 ─────────────────────────────────────────────────────────────

/** 응답이 있는 실행만 관측으로 친다. 못 붙은 실행은 서버 모양에 대해 아무것도 안 알려 준다. */
function observationsFor(runs: readonly RunRecord[], name: string, baseVersion?: string | null): RunRecord[] {
  return runs
    .filter((r) => r.requestName === name && r.response !== null)
    .filter((r) => (baseVersion == null ? true : r.baseVersion === baseVersion))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

export function driftFromObservations(input: ObservationInput): DriftResult {
  const { spec, runs, environmentName, baseVersion = null } = input
  const ctx: Ctx = { findings: [], skippedUnknown: 0 }
  const unobserved: string[] = []
  const unparsable: string[] = []
  const unstable: string[] = []
  let observed = 0

  for (const request of spec.requests) {
    const found = observationsFor(runs, request.name, baseVersion)
    if (found.length === 0) {
      unobserved.push(request.name)
      continue
    }
    const latest = found[0]
    const parsed = shapeOfBody(latest.response!.body)
    if (!parsed.json) {
      unparsable.push(request.name)
      continue
    }
    observed += 1

    // 서버가 도중에 바뀌었을 수 있다 — 판정을 막진 않되 사실은 보인다.
    if (found.length > 1) {
      const prev = shapeOfBody(found[1].response!.body)
      if (prev.json && JSON.stringify(prev.shape) !== JSON.stringify(parsed.shape)) unstable.push(request.name)
    }

    const status = String(latest.response!.status)
    const declared = request.responses.find((r) => r.status === status)
    if (!declared) {
      ctx.findings.push({
        kind: 'server-only',
        path: `${request.name}.${status}`,
        detail: `상태 ${status} 를 받았는데 명세에 선언이 없습니다.`,
        actual: status
      })
      continue
    }
    compareFields(ctx, `${request.name}.${status}`, declared.fields, parsed.shape)
  }

  return {
    grade: 'observed',
    unavailable: null,
    environmentName,
    baseVersion,
    coverage: { total: spec.requests.length, observed, unobserved, unparsable },
    findings: ctx.findings,
    skippedUnknown: ctx.skippedUnknown,
    unstable
  }
}

// ── 완전 판정 ─────────────────────────────────────────────────────────────

/** 서버가 스키마를 통째로 뱉는 인터페이스에서, 루트 이름 → 반환 필드 모양. */
export interface ServerSchema {
  rootFields: Record<string, FieldDef[]>
}

export interface SchemaDriftInput {
  spec: SpecDef
  schema: ServerSchema
  environmentName: string
  /** 요청 이름 → 서버 루트 필드 이름. 못 읽은 요청은 여기 없다(그러면 판정에서 빠진다). */
  rootOf: Record<string, string | null>
}

/**
 * 서버 스키마 전량 대조. 커버리지 100% 인 이유는 **서버가 자기 것을 다 말해 줬기 때문**이다 —
 * 다만 우리 쪽에서 루트 이름을 못 읽은 요청은 여전히 판정 밖이고, 그 사실을 숨기지 않는다.
 */
export function driftFromSchema(input: SchemaDriftInput): DriftResult {
  const { spec, schema, environmentName, rootOf } = input
  const ctx: Ctx = { findings: [], skippedUnknown: 0 }
  const unobserved: string[] = []
  let observed = 0

  for (const request of spec.requests) {
    const root = rootOf[request.name] ?? null
    if (!root) {
      // 어느 루트 필드를 부르는지 못 읽었다 — 모르면 모른다고 둔다.
      unobserved.push(request.name)
      continue
    }
    const serverFields = schema.rootFields[root]
    if (!serverFields) {
      ctx.findings.push({
        kind: 'spec-only',
        path: `${request.name}.${root}`,
        detail: `서버 스키마에 '${root}' 이(가) 없습니다 — 이 요청은 지금 서버에서 깨집니다.`,
        declared: root
      })
      observed += 1
      continue
    }
    observed += 1
    const declared = request.responses[0]?.fields ?? []
    compareFields(ctx, `${request.name}.${root}`, declared, serverFields)
  }

  return {
    grade: 'complete',
    unavailable: null,
    environmentName,
    baseVersion: null,
    coverage: { total: spec.requests.length, observed, unobserved, unparsable: [] },
    findings: ctx.findings,
    skippedUnknown: ctx.skippedUnknown,
    unstable: []
  }
}

/** 완전 판정을 못 한 결과. **관측 결과로 대체하지 않는다** — 빈 결과에 사유를 단다. */
export function driftUnavailable(
  reason: UnavailableReason,
  message: string,
  environmentName: string
): DriftResult {
  return {
    grade: 'complete',
    unavailable: { reason, message },
    environmentName,
    baseVersion: null,
    coverage: { total: 0, observed: 0, unobserved: [], unparsable: [] },
    findings: [],
    skippedUnknown: 0,
    unstable: []
  }
}

// ── 요약 ──────────────────────────────────────────────────────────────────

/** 사람이 읽을 한 줄. **커버리지 없는 "이상 없음" 은 만들 수 없다.** */
export function summarizeDrift(d: DriftResult): string {
  if (d.unavailable) return `판정 불가 — ${UNAVAILABLE_LABEL[d.unavailable.reason]}`
  const cov =
    d.grade === 'complete'
      ? `전량 대조 ${d.coverage.observed}/${d.coverage.total}`
      : `${d.coverage.observed}/${d.coverage.total} 관측`
  const skipped = d.skippedUnknown > 0 ? ` · 모름 ${d.skippedUnknown}개 제외` : ''
  const unparsable =
    d.coverage.unparsable.length > 0 ? ` · 모양 못 읽음 ${d.coverage.unparsable.length}개` : ''
  const head = d.findings.length === 0 ? '이상 없음' : `어긋남 ${d.findings.length}건`
  return `${head} (${cov}${skipped}${unparsable})`
}

/**
 * 코드를 고쳐야 하는 것이 남았나.
 * `server-only` 는 명세로 흡수하면 되므로 막지 않는다 — 나머지 둘은 실제로 깨지는 쪽이다.
 */
export function hasBlockingGap(d: DriftResult): boolean {
  return d.findings.some((f) => f.kind !== 'server-only')
}

/** 흡수 후보(= 명세로 받아들일 수 있는 것)와 코드로 넘길 것을 가른다. */
export function splitFindings(d: DriftResult): { absorb: DriftFinding[]; report: DriftFinding[] } {
  return {
    absorb: d.findings.filter((f) => f.kind === 'server-only'),
    report: d.findings.filter((f) => f.kind !== 'server-only')
  }
}
