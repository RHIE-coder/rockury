import { shapeOfBody } from './observed'
import { matchExpectedBody } from './inbox'
import { interfaceMeta } from './types'
import type { FieldDef, RequestDef, RunRecord, SpecDef } from './types'

/**
 * 판정.
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
  /**
   * 관측은 쌓였지만 **그 관측을 어느 선언과 맞출지 못 정한** 요청.
   *
   * 스트림은 메시지의 **이벤트 이름**으로 선언을 찾는다(`ResponseDef.status` 가 그 자리다).
   * 이름이 없는 메시지(WebSocket 이 흔히 그렇다)는 어느 선언과 맞출지 우리가 모른다 —
   * **추측해서 하나뿐인 선언에 갖다 붙이지 않는다.** 한 소켓에 여러 종류가 흐르는 것이
   * WebSocket 의 보통 모습이라, 그 추측은 조용히 틀린 판정을 만든다.
   *
   * 미관측과 갈라 두는 이유: 미관측은 *쏴 보면* 풀리고, 이쪽은 *이벤트 이름을 붙이거나
   * 선언을 더해야* 풀린다. 어느 쪽도 통과가 아니다.
   */
  unjudged: string[]
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
  /**
   * 어느 선언과 맞출지 못 정한 **메시지 건수**. 0 이어도 실린다(없는 것과 0 은 다르다).
   * 일부만 대조된 요청이 "전부 봤다"로 읽히지 않게 하는 자리다.
   */
  unroutedMessages: number
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

/**
 * 응답이 있는 **단발** 실행만 관측으로 친다.
 *
 * `shape` 는 요청에 선언된 것이 아니라 **그 실행이 실제로 무엇이었는지**를 본다 —
 * duplex 로 선언된 요청을 Send 로 한 번 쏴 볼 수도 있고(막지 않는다), 그 관측은
 * 여전히 응답 본문 대조 대상이다. 선언으로 가르면 그 findings 가 통째로 사라진다.
 */
function observationsFor(runs: readonly RunRecord[], name: string, baseVersion?: string | null): RunRecord[] {
  return runs
    .filter((r) => r.requestName === name && r.shape === 'unary' && r.response !== null)
    .filter((r) => (baseVersion == null ? true : r.baseVersion === baseVersion))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/**
 * 판정에 쓸 스트림·수신 세션 기록. 붙은 뒤 끝난 것만이 관측이다.
 * **가장 최근 것부터** 온다 — 판정은 최신 하나만 본다(단발이 "가장 최근 성공 Run" 을
 * 기준으로 삼는 것과 같은 규칙 — AC-4).
 */
function sessionsFor(
  runs: readonly RunRecord[],
  name: string,
  baseVersion?: string | null
): RunRecord[] {
  return runs
    .filter(
      (r) =>
        r.requestName === name &&
        r.shape !== 'unary' &&
        r.status === 'ok' &&
        (baseVersion == null ? true : r.baseVersion === baseVersion)
    )
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/**
 * 스트림·수신 관측이 **실제로 있었나.**
 *
 * "행이 있나"로 세면 안 된다 — 접속 실패한 세션도 Run 으로 남기 때문에, 한 번도 못 붙은
 * 요청이 "세션은 쌓였지만 대조 규칙이 없다"로 뜬다. 그건 미관측이다.
 *
 * `status === 'ok'` 를 조건으로 쓰는 이유: 스트림 상태 판정(`stream.ts` streamRunStatus)에서
 * `ok` 는 **붙은 뒤 끝난 세션에만** 나온다(못 붙으면 connect-failed·timeout, 붙기 전에 끄면
 * cancelled, 스트림을 안 주면 http-error). 메시지 본문을 안 보는 것도 의도다 —
 * 목록 조회는 본문을 안 읽으므로(그러면 메인이 멈춘다) 본문에 의존하면 판정이 조용히
 * "관측 없음"으로 뒤집힌다.
 */
function hasStreamObservation(
  runs: readonly RunRecord[],
  name: string,
  baseVersion?: string | null
): boolean {
  return runs.some(
    (r) =>
      r.requestName === name &&
      r.shape !== 'unary' &&
      r.status === 'ok' &&
      (baseVersion == null ? true : r.baseVersion === baseVersion)
  )
}

/**
 * 옛 판정 기록을 지금 타입으로 맞춘다.
 *
 * `DriftResult` 는 `api_contract_logs.payload` 에 **JSON 통째로** 저장된다. 커버리지에 칸을
 * 더하면 그 전에 쌓인 기록은 그 칸이 없는 채로 돌아오고, 화면·요약이 `.length` 를 부르는
 * 순간 터진다 — 렌더러에 error boundary 가 없어 판정 화면이 백지가 되고, 재판정 버튼까지
 * 사라져 스스로 복구할 길이 없어진다(`api_runs` 는 컬럼 ALTER 로 막았는데 이쪽은 JSON 이라
 * 마이그레이션이 닿지 않는다 — 읽는 자리에서 맞춰 준다).
 */
export function normalizeDrift(raw: DriftResult): DriftResult {
  const c = (raw.coverage ?? {}) as Partial<DriftCoverage>
  return {
    ...raw,
    coverage: {
      total: c.total ?? 0,
      observed: c.observed ?? 0,
      unobserved: c.unobserved ?? [],
      unparsable: c.unparsable ?? [],
      unjudged: c.unjudged ?? []
    },
    findings: raw.findings ?? [],
    unstable: raw.unstable ?? [],
    skippedUnknown: raw.skippedUnknown ?? 0,
    unroutedMessages: raw.unroutedMessages ?? 0
  }
}

/**
 * 스트림 세션 관측을 판정한다.
 *
 * **이벤트 이름이 선언을 고른다** — `ResponseDef.status` 는 단발에선 상태코드지만
 * 스트림에선 "이벤트 종류"다(`types.ts` 가 그렇게 적어 뒀다). 이름 없는 메시지는
 * **어느 선언과 맞출지 우리가 모르므로 세어 두고 넘어간다** — 하나뿐인 선언에 갖다
 * 붙이면 한 소켓에 여러 종류가 흐르는 보통의 WebSocket 에서 조용히 틀린 판정이 나온다.
 */
function judgeStream(
  ctx: Ctx,
  request: RequestDef,
  runs: readonly RunRecord[]
): { judged: number; unrouted: number } {
  let judged = 0
  let unrouted = 0

  for (const m of runs.flatMap((r) => r.messages ?? [])) {
    if (m.direction !== 'in') continue
    if (!m.event) {
      unrouted += 1
      continue
    }
    const declared = request.responses.find((r) => r.status === m.event)
    if (!declared) {
      // 단발의 "상태 X 를 받았는데 선언이 없다" 와 같은 자리다.
      if (!ctx.findings.some((f) => f.path === `${request.name}.${m.event}`)) {
        ctx.findings.push({
          kind: 'server-only',
          path: `${request.name}.${m.event}`,
          detail: `이벤트 '${m.event}' 를 받았는데 명세에 선언이 없습니다.`,
          actual: m.event
        })
      }
      judged += 1
      continue
    }
    const parsed = shapeOfBody(m.data)
    if (!parsed.json) {
      // JSON 이 아니면 모양을 못 뽑는다 — 대조 못 한 것으로 센다(통과가 아니다).
      unrouted += 1
      continue
    }
    compareFields(ctx, `${request.name}.${m.event}`, declared.fields, parsed.shape)
    judged += 1
  }
  return { judged, unrouted }
}

/**
 * 웹훅 수신 관측을 판정한다.
 *
 * 받는 쪽의 선언은 응답 모양이 아니라 **기대 본문**(`expectedBody`)이다 — 수신할 때
 * 이미 같은 함수로 대조했고(`inbox.received AC-3`), 여기서는 쌓인 기록을 같은 규칙으로
 * 다시 본다. **선언이 없으면 대조 못 한 것**이지 통과가 아니다.
 */
function judgeInbound(
  ctx: Ctx,
  request: RequestDef,
  runs: readonly RunRecord[]
): { judged: number; unrouted: number } {
  let judged = 0
  let unrouted = 0

  for (const m of runs.flatMap((r) => r.messages ?? [])) {
    if (m.direction !== 'in') continue
    const result = matchExpectedBody(m.data, request.request.expectedBody)
    if (result.verdict === 'undeclared' || result.verdict === 'unparsable') {
      unrouted += 1
      continue
    }
    for (const issue of result.issues) {
      const path = `${request.name}.${issue.path}`
      if (ctx.findings.some((f) => f.path === path)) continue
      ctx.findings.push({ kind: 'different', path, detail: issue.detail })
    }
    ctx.skippedUnknown += result.skippedUnknown
    judged += 1
  }
  return { judged, unrouted }
}

/**
 * 대조할 단발 관측이 없을 때, 그 요청을 어느 통에 넣나.
 *
 * 스트림·수신 세션이 있었으면 **판정 규칙 없음**(대조 규칙을 우리가 아직 안 만들었다),
 * 아무것도 없으면 **미관측**(쏴 보면 풀린다). 통과는 어느 쪽도 아니다.
 * 완전 판정·관측 판정 **양쪽**이 같은 이 함수를 쓴다 — 한쪽만 고치면 형제 경로가
 * "없는 어긋남"을 계속 만든다.
 */
function bucketUnobserved(
  name: string,
  runs: readonly RunRecord[],
  baseVersion: string | null,
  unjudged: string[],
  unobserved: string[]
): void {
  ;(hasStreamObservation(runs, name, baseVersion) ? unjudged : unobserved).push(name)
}

export function driftFromObservations(input: ObservationInput): DriftResult {
  const { spec, runs, environmentName, baseVersion = null } = input
  const ctx: Ctx = { findings: [], skippedUnknown: 0 }
  const unobserved: string[] = []
  const unparsable: string[] = []
  const unjudged: string[] = []
  const unstable: string[] = []
  let observed = 0
  let unroutedMessages = 0

  for (const request of spec.requests) {
    // **선언 모양으로 먼저 가르지 않는다.** duplex 로 선언한 요청을 Send 로 한 번 쏴 볼 수도
    // 있고(막지 않는다), 그 단발 관측은 여전히 응답 본문 대조 대상이다 — 선언으로 갈라
    // 건너뛰면 그 findings 가 통째로 사라진다.
    const found = observationsFor(runs, request.name, baseVersion)
    if (found.length === 0) {
      // 단발 관측이 없다. 스트림·수신 세션이 있으면 **그쪽 규칙으로 판정한다.**
      const sessions = sessionsFor(runs, request.name, baseVersion)
      if (sessions.length === 0) {
        unobserved.push(request.name)
        continue
      }
      // 최신 세션 하나만 본다 — 지나간 세션까지 겹쳐 보면 이미 고친 어긋남이 계속 살아난다.
      const latest = sessions.slice(0, 1)
      const r =
        request.shape === 'inbound'
          ? judgeInbound(ctx, request, latest)
          : judgeStream(ctx, request, latest)
      unroutedMessages += r.unrouted
      // 하나도 못 맞췄으면 관측으로 세지 않는다 — 대조한 것이 없다.
      if (r.judged === 0) unjudged.push(request.name)
      else observed += 1
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
    coverage: { total: spec.requests.length, observed, unobserved, unparsable, unjudged },
    findings: ctx.findings,
    skippedUnknown: ctx.skippedUnknown,
    unstable,
    unroutedMessages
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
  /**
   * 스트림 관측 유무를 가리는 데 쓴다 — 스키마가 스트리밍을 안 덮는 경우(아래) 그 요청이
   * "안 쏴 봤다"인지 "쏴 봤는데 대조할 규칙이 없다"인지 갈라 커버리지에 정직하게 싣는다.
   */
  runs?: readonly RunRecord[]
}

/**
 * 서버 스키마 전량 대조. 커버리지 100% 인 이유는 **서버가 자기 것을 다 말해 줬기 때문**이다 —
 * 다만 우리 쪽에서 루트 이름을 못 읽은 요청은 여전히 판정 밖이고, 그 사실을 숨기지 않는다.
 */
export function driftFromSchema(input: SchemaDriftInput): DriftResult {
  const { spec, schema, environmentName, rootOf, runs = [] } = input
  // **호출처가 손으로 넘기지 않는다.** 종류별 능력은 `INTERFACE_META` 하나가 든다 —
  // 옵션이면 새 종류를 얹을 때 빠뜨려도 아무것도 안 깨지고 그 종류의 스트리밍만 조용히 빠진다.
  const covers = interfaceMeta(spec.kind).schemaCoversStreaming
  const ctx: Ctx = { findings: [], skippedUnknown: 0 }
  const unobserved: string[] = []
  const unjudged: string[] = []
  let observed = 0

  for (const request of spec.requests) {
    // 완전 판정에서는 **선언 모양으로 가른다** — 스키마가 스트리밍을 안 덮으면 어떻게 쏴 봤든
    // 대조할 것이 없기 때문이다. 덮는 스키마(gRPC reflection)에서는 안 가른다.
    // 수신(웹훅)은 어느 쪽이든 대조 대상이 아니다 — 부르는 쪽이 서버다.
    const outOfScope =
      request.shape === 'inbound' || (request.shape !== 'unary' && !covers)
    if (outOfScope) {
      bucketUnobserved(request.name, runs, null, unjudged, unobserved)
      continue
    }

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
    coverage: { total: spec.requests.length, observed, unobserved, unparsable: [], unjudged },
    findings: ctx.findings,
    skippedUnknown: ctx.skippedUnknown,
    unstable: [],
    unroutedMessages: 0
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
    coverage: { total: 0, observed: 0, unobserved: [], unparsable: [], unjudged: [] },
    findings: [],
    skippedUnknown: 0,
    unstable: [],
    unroutedMessages: 0
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
  // 스트림·수신은 쌓아 놨어도 대조를 못 했다. 요약 한 줄만 보고 "이상 없음"으로 읽히면 안 된다.
  const unjudged =
    d.coverage.unjudged.length > 0 ? ` · 맞출 선언 없음 ${d.coverage.unjudged.length}개` : ''
  // 일부만 대조된 요청이 "전부 봤다" 로 읽히지 않게 건수를 붙인다.
  const unrouted = d.unroutedMessages > 0 ? ` · 못 맞춘 메시지 ${d.unroutedMessages}건` : ''
  const head = d.findings.length === 0 ? '이상 없음' : `어긋남 ${d.findings.length}건`
  return `${head} (${cov}${skipped}${unparsable}${unjudged}${unrouted})`
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
