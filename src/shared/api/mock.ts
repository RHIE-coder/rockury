import type { FieldDef, RequestDef, ResponseDef, SpecDef } from './types'

/**
 * 모의(가짜) 서버의 순수 규칙 — `docs/spec/api-studio.md` § mocking.server.
 *
 * 목적은 하나다: **프론트가 백엔드 완성을 안 기다려도 되게.**
 * 그런데 이 서비스의 한 문장이 여기서 특히 세게 걸린다 — **모르는 것을 안다고 말하지 않는다.**
 *
 *   · 선언이 없으면 **가짜 본문을 지어내지 않는다.** 501 과 사유를 준다.
 *     그럴듯한 JSON 을 만들어 주면 프론트가 없는 계약 위에 화면을 짓는다.
 *   · 값은 **일부러 가짜처럼 보이게** 만든다(`(mock:이름)`). 진짜처럼 보이면 스크린샷 한 장이
 *     "이미 되는 것"으로 돌아다닌다.
 *   · `없을 수 있음`으로 선언한 필드는 **null 로 낸다.** 값을 지어내면 프론트가 "항상 있다"고
 *     믿고 null 경로를 안 짜게 된다 — mock 의 값어치는 거기에 있다.
 *   · `모름`으로 선언한 필드는 내되 **몇 개를 짐작했는지 응답에 싣는다.**
 */

/** 가짜 응답임을 밝히는 헤더 — 진짜 서버 응답과 섞이지 않게. */
export const MOCK_HEADER = 'x-rockury-mock'
/** 짐작으로 채운 필드 수를 알리는 헤더. 0 이어도 싣는다(없는 것과 0 은 다르다). */
export const MOCK_GUESSED_HEADER = 'x-rockury-mock-guessed'

export interface MockBody {
  /** 만들어진 본문(JSON 문자열). */
  body: string
  /** 필수여부 `모름` 때문에 **짐작으로** 넣은 필드 수. */
  guessed: number
}

function valueOf(f: FieldDef, counters: { guessed: number }): unknown {
  if (f.requiredness === 'unknown') counters.guessed += 1
  // 없을 수 있다고 선언했으면 **null 로 낸다** — 값을 지어내면 null 경로를 안 짜게 된다.
  if (f.requiredness === 'nullable') return null

  // 허용 값은 우리가 **아는** 값이다 — 여기서만 진짜 같은 값을 쓴다.
  if (f.enumValues && f.enumValues.length > 0) return f.enumValues[0]

  switch (f.type) {
    case 'string':
      // 일부러 가짜처럼 보이게. 그럴듯하면 스크린샷이 "이미 되는 것"으로 돌아다닌다.
      return `(mock:${f.name})`
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array': {
      const inner = f.fields ?? []
      if (inner.length === 0) return []
      // 배열은 원소 하나만 낸다 — 몇 개가 오는지는 선언에 없다(모른다).
      const el = inner.find((x) => x.name === '[]')
      return [el ? valueOf(el, counters) : objectOf(inner, counters)]
    }
    case 'object':
      return objectOf(f.fields ?? [], counters)
  }
}

function objectOf(fields: readonly FieldDef[], counters: { guessed: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    // 배열 원소 표식은 키가 아니다 — 객체에 `[]` 라는 필드를 만들면 안 된다.
    if (f.name === '[]') continue
    out[f.name] = valueOf(f, counters)
  }
  return out
}

/** 선언한 응답 모양 하나 → 가짜 본문. */
export function mockBody(response: ResponseDef): MockBody {
  const counters = { guessed: 0 }
  const root = response.fields.find((f) => f.name === '[]')
  const value = root ? [objectOf(root.fields ?? [], counters)] : objectOf(response.fields, counters)
  return { body: JSON.stringify(value, null, 2), guessed: counters.guessed }
}

// ── 경로 대조 ─────────────────────────────────────────────────────────────

/**
 * 선언한 경로가 들어온 경로와 맞나.
 * `{{userId}}` 자리는 **아무 조각이나** 받는다 — 그 값이 무엇일지는 선언에 없다.
 */
export function pathMatches(declared: string, actual: string): boolean {
  const strip = (p: string): string[] =>
    p.split('?')[0].split('/').filter(Boolean)
  const d = strip(declared)
  const a = strip(actual)
  if (d.length !== a.length) return false
  return d.every((seg, i) => (/\{\{.*\}\}/.test(seg) ? a[i].length > 0 : seg === a[i]))
}

export interface RouteMatch {
  request: RequestDef
  /** 어느 상태로 답하나. 화면이 고른 것이 있으면 그것, 없으면 아래 규칙. */
  response: ResponseDef | null
  /** 답할 수 없는 이유. `response` 가 null 일 때만 채워진다. */
  unavailable: string | null
}

/**
 * 어느 상태로 답할지 고른다.
 * 기본은 **가장 낮은 2xx** — 없으면 첫 선언. 화면에서 상태를 골라 두면 그것이 이긴다
 * (오류 경로를 짜 보려면 4xx·5xx 를 낼 수 있어야 한다).
 */
export function pickResponse(request: RequestDef, preferred?: string): RouteMatch {
  if (request.responses.length === 0) {
    return {
      request,
      response: null,
      // **여기서 지어내지 않는다.** 그럴듯한 JSON 을 주면 프론트가 없는 계약 위에 화면을 짓는다.
      unavailable:
        `요청 '${request.name}' 에 응답 모양 선언이 없어 가짜 응답을 만들 수 없습니다 — ` +
        'Studio › Requests 에서 응답 모양을 선언하면 그대로 흉내 냅니다.'
    }
  }
  if (preferred) {
    const hit = request.responses.find((r) => r.status === preferred)
    if (hit) return { request, response: hit, unavailable: null }
    return {
      request,
      response: null,
      unavailable: `상태 '${preferred}' 는 이 요청에 선언되어 있지 않습니다.`
    }
  }
  const twoXx = request.responses
    .filter((r) => /^2\d\d$/.test(r.status))
    .sort((a, b) => Number(a.status) - Number(b.status))
  return { request, response: twoXx[0] ?? request.responses[0], unavailable: null }
}

/**
 * 들어온 요청 → 어느 선언이 답하나.
 *
 * **REST 만 흉내 낸다**(1차). GraphQL·JSON-RPC 는 경로+메서드로 갈리지 않고 본문의
 * 질의문·메서드 이름으로 갈리며, gRPC 는 HTTP/2 프레이밍이 필요하다 — 흉내 내면
 * "붙었는데 엉뚱한 게 온다"가 된다(Stream 이 전송을 안 흉내 낸 것과 같은 선).
 */
export function mockableRequests(spec: SpecDef): RequestDef[] {
  if (spec.kind !== 'rest') return []
  return spec.requests.filter((r) => r.shape === 'unary')
}

export function mockUnsupportedReason(spec: SpecDef): string | null {
  if (spec.kind === 'rest') return null
  return (
    `${spec.kind} 는 아직 흉내 내지 않습니다 — 경로+메서드로 갈리지 않아서(본문의 질의문·` +
    '메서드 이름으로 갈립니다) 지금 라우팅으로는 엉뚱한 응답을 주게 됩니다.'
  )
}

export function matchRoute(
  spec: SpecDef,
  method: string,
  path: string,
  preferred: Record<string, string> = {}
): RouteMatch | null {
  for (const r of mockableRequests(spec)) {
    const declaredMethod = (r.request.method ?? 'GET').toUpperCase()
    if (declaredMethod !== method.toUpperCase()) continue
    if (!pathMatches(r.request.path ?? '', path)) continue
    return pickResponse(r, preferred[r.name])
  }
  return null
}

/** 화면·서버가 함께 쓰는 기본 포트. Inbox(7799) 와 안 겹친다. */
export const DEFAULT_MOCK_PORT = 7788
