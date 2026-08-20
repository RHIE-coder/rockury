import { shapeOfBody } from './observed'
import type { FieldDef, RequestDef, RunRecord, StreamMessage } from './types'

/**
 * 웹훅 수신의 순수 규칙
 *
 * 4모양 중 **유일하게 방향이 반대**다: 내가 안 보냈는데 들어온다. 그래서 "보낼 수 있나"를
 * 묻는 관문이 없고, 대신 **들어온 것이 선언한 모양과 맞나**를 묻는다.
 *
 * 이 파일이 지키는 한 문장: **모르는 것을 안다고 말하지 않는다.**
 * 기대 스키마 선언이 없으면 `맞음`이 아니라 **`선언 없음`** 이다 — 대조할 것이 없었다는 사실을
 * 통과로 바꾸지 않는다(판정 쪽 `unparsable` 과 같은 규율).
 */

// ── 기대 본문 대조 ────────────────────────────────────────────────────────

export const MATCH_VERDICTS = ['match', 'mismatch', 'undeclared', 'unparsable'] as const
export type MatchVerdict = (typeof MATCH_VERDICTS)[number]

export const MATCH_LABEL: Record<MatchVerdict, string> = {
  match: '선언과 맞음',
  mismatch: '선언과 어긋남',
  undeclared: '선언 없음',
  unparsable: 'JSON 이 아니라 대조 불가'
}

export interface MatchIssue {
  /** 필드 경로. 루트면 필드 이름 그대로. */
  path: string
  detail: string
}

export interface MatchResult {
  verdict: MatchVerdict
  issues: MatchIssue[]
  /** 필수여부 `모름` 때문에 대조에서 뺀 필드 수 — 뺐다는 사실을 결과가 들고 있는다. */
  skippedUnknown: number
}

/** `expectedBody` 텍스트를 필드 선언으로 읽는다. JSON 배열 모양의 `FieldDef[]` 를 기대한다. */
export function parseExpected(text: string | undefined): FieldDef[] | null {
  if (!text || !text.trim()) return null
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? (v as FieldDef[]) : null
  } catch {
    // 선언이 깨졌으면 **추측하지 않는다** — 없는 것과 같이 다루고 화면이 '선언 없음'을 말한다.
    return null
  }
}

function compare(
  declared: readonly FieldDef[],
  actual: readonly FieldDef[],
  base: string,
  out: MatchIssue[],
  counters: { skipped: number }
): void {
  const actualBy = new Map(actual.map((a) => [a.name, a]))
  for (const d of declared) {
    const path = base ? `${base}.${d.name}` : d.name
    const a = actualBy.get(d.name)
    if (!a) {
      // 모르는 것을 어긋남으로도 통과로도 세지 않는다.
      if (d.requiredness === 'unknown') {
        counters.skipped += 1
        continue
      }
      // 없을 수 있다고 선언한 것이 이번에 없는 것은 정상이다.
      if (d.requiredness === 'nullable') continue
      out.push({ path, detail: `필수로 선언한 '${d.name}' 이(가) 본문에 없습니다.` })
      continue
    }
    if (a.type === 'null') {
      if (d.requiredness === 'unknown') counters.skipped += 1
      else if (d.requiredness === 'required') {
        out.push({ path, detail: `필수로 선언했는데 본문에서 null 이었습니다.` })
      }
      continue
    }
    if (d.type !== a.type) {
      out.push({ path, detail: `타입이 다릅니다 — 선언 ${d.type} / 실제 ${a.type}.` })
      continue
    }
    compare(d.fields ?? [], a.fields ?? [], path, out, counters)
  }
  // 선언에 없는 필드는 **어긋남이 아니다.** 웹훅 발신자는 남이고, 그쪽이 필드를 더하는 것은
  // 흔한 일이다. 우리가 선언한 것이 오는지만 본다(판정의 `server-only` 와 다른 자리다).
}

/**
 * 들어온 본문을 선언한 기대 모양과 대조한다 (inbox.received AC-3).
 *
 * 네 갈래로 갈린다 — **`선언 없음`과 `대조 불가`를 `맞음`으로 뭉치지 않는다.**
 */
export function matchExpectedBody(body: string, expected: string | undefined): MatchResult {
  const declared = parseExpected(expected)
  if (!declared) return { verdict: 'undeclared', issues: [], skippedUnknown: 0 }

  const parsed = shapeOfBody(body)
  if (!parsed.json) return { verdict: 'unparsable', issues: [], skippedUnknown: 0 }

  const issues: MatchIssue[] = []
  const counters = { skipped: 0 }
  compare(declared, parsed.shape, '', issues, counters)
  return {
    verdict: issues.length === 0 ? 'match' : 'mismatch',
    issues,
    skippedUnknown: counters.skipped
  }
}

// ── 포트 ──────────────────────────────────────────────────────────────────

/** 1차 기본 포트. 흔히 안 쓰는 자리를 골랐다(개발 서버 3000·5173·8080 과 안 겹친다). */
export const DEFAULT_INBOX_PORT = 7799

/**
 * 쓰는 포트면 다른 포트를 제안한다 (inbox.listener AC-2).
 * **자동으로 옮겨 붙지 않는다** — 주소를 이미 남에게 알려 줬을 수 있으므로 사람이 고른다.
 */
export function suggestPort(taken: number, inUse: (p: number) => boolean): number | null {
  for (let p = taken + 1; p <= taken + 50 && p <= 65_535; p += 1) {
    if (!inUse(p)) return p
  }
  return null
}

/** 화면에 보이는 수신 주소. **로컬 전용**이라 호스트를 못 바꾼다(AC-3). */
export function inboxUrl(port: number): string {
  return `http://127.0.0.1:${port}/`
}

// ── 받은 것 ───────────────────────────────────────────────────────────────

export interface ReceivedRequest {
  id: string
  at: string
  method: string
  /** 들어온 경로(쿼리 포함). */
  path: string
  headers: Record<string, string>
  body: string
  /** 본문 바이트 크기 — 목록에 그대로 보인다(AC-1). */
  size: number
  /** 우리가 되돌려준 코드. */
  respondedWith: number
  match: MatchResult
}

/** 목록 한 줄에 담기는 것 (AC-1). 시각은 원문 ISO 를 그대로 들고 있는다. */
export interface ReceivedRow {
  id: string
  at: string
  method: string
  path: string
  size: number
  verdict: MatchVerdict
}

export function receivedRow(r: ReceivedRequest): ReceivedRow {
  return {
    id: r.id,
    at: r.at,
    method: r.method,
    path: r.path,
    size: r.size,
    verdict: r.match.verdict
  }
}

export interface InboxRunInput {
  specId: string
  requestName: string
  environmentId: string
  environmentName: string
  baseVersion: string | null
  received: ReceivedRequest
}

/**
 * 수신 하나 = Run 하나 (AC-4). **웹훅도 관측 기록이다.**
 *
 * 방향이 반대라 칸의 뜻도 반대다: `request` 는 **들어온 것**(우리가 관측한 것),
 * `response` 는 **우리가 되돌려준 것**이다. 대조 결과는 `messages` 에 한 줄로 남긴다 —
 * 판정기는 `shape` 이 `unary` 가 아니면 대조하지 않으므로(판정 규칙이 아직 없다) 이 값을
 * 응답 모양으로 오독하지 않는다.
 */
export function receivedToRun(input: InboxRunInput): Omit<RunRecord, 'id' | 'createdAt'> {
  const r = input.received
  const messages: StreamMessage[] = [
    { seq: 1, at: r.at, direction: 'in', event: `${r.method} ${r.path}`, data: r.body },
    {
      seq: 2,
      at: r.at,
      direction: 'system',
      event: 'match',
      data:
        MATCH_LABEL[r.match.verdict] +
        (r.match.issues.length > 0
          ? ` — ${r.match.issues.map((i) => `${i.path}: ${i.detail}`).join(' / ')}`
          : '') +
        (r.match.skippedUnknown > 0 ? ` (모름 ${r.match.skippedUnknown}개 제외)` : '')
    }
  ]
  return {
    specId: input.specId,
    requestName: input.requestName,
    environmentId: input.environmentId,
    environmentName: input.environmentName,
    baseVersion: input.baseVersion,
    shape: 'inbound',
    // 받는 쪽은 **우리가 넣은 파라미터가 없다** — 남이 보낸 것이다. 빈 묶음이 사실이다.
    call: {},
    // 받았다는 사실 자체가 관측이다 — 대조가 어긋났어도 수신은 성공이다(둘은 다른 축이다).
    status: 'ok',
    httpStatus: r.respondedWith,
    durationMs: 0,
    request: { method: r.method, url: r.path, headers: r.headers, body: r.body },
    response: { status: r.respondedWith, headers: {}, body: '', size: 0 },
    messages,
    messageCount: messages.length,
    error: null
  }
}

/** 이 명세에서 수신 대기를 걸 수 있는 요청 — `inbound` 모양만이다. */
export function inboundRequests(requests: readonly RequestDef[]): RequestDef[] {
  return requests.filter((r) => r.shape === 'inbound')
}
