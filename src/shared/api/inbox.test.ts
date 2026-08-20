import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INBOX_PORT,
  inboundRequests,
  inboxUrl,
  matchExpectedBody,
  parseExpected,
  receivedRow,
  receivedToRun,
  suggestPort,
  type ReceivedRequest
} from './inbox'
import type { FieldDef, RequestDef } from './types'

/**
 * TestPlan: api-runner · Scenario S5
 *   CASE-apirunner-043 수신 본문 대조 · 044 포트 충돌 · 046 수신 목록 행 · 047 수신 → Run
 */

const f = (name: string, type: FieldDef['type'], requiredness: FieldDef['requiredness']): FieldDef => ({
  name,
  type,
  requiredness
})

const declare = (...fields: FieldDef[]): string => JSON.stringify(fields)

// ── CASE-apirunner-043 ────────────────────────────────────────────────────

describe('수신 본문 대조 (CASE-apirunner-043)', () => {
  it('선언한 필드가 다 오면 맞음이다', () => {
    const r = matchExpectedBody('{"id":"x","n":1}', declare(f('id', 'string', 'required'), f('n', 'number', 'required')))
    expect(r.verdict).toBe('match')
    expect(r.issues).toEqual([])
  })

  it('**스키마 선언이 없으면 `선언 없음`이고 맞음이 아니다**', () => {
    expect(matchExpectedBody('{"id":"x"}', undefined).verdict).toBe('undeclared')
    expect(matchExpectedBody('{"id":"x"}', '').verdict).toBe('undeclared')
    expect(matchExpectedBody('{"id":"x"}', '   ').verdict).toBe('undeclared')
  })

  it('선언이 깨져 있으면 추측하지 않고 `선언 없음`으로 둔다', () => {
    expect(matchExpectedBody('{"id":"x"}', '{ 이건 JSON 이 아니다').verdict).toBe('undeclared')
    // 배열이 아닌 JSON 도 필드 선언이 아니다.
    expect(matchExpectedBody('{"id":"x"}', '{"id":"string"}').verdict).toBe('undeclared')
  })

  it('본문이 JSON 이 아니면 **대조 불가**다 — 맞음도 어긋남도 아니다', () => {
    const r = matchExpectedBody('<xml/>', declare(f('id', 'string', 'required')))
    expect(r.verdict).toBe('unparsable')
    expect(r.issues).toEqual([])
  })

  it('필수로 선언한 필드가 없으면 어긋남이고 이름을 지목한다', () => {
    const r = matchExpectedBody('{}', declare(f('id', 'string', 'required')))
    expect(r.verdict).toBe('mismatch')
    expect(r.issues[0].path).toBe('id')
    expect(r.issues[0].detail).toContain('id')
  })

  it('타입이 다르면 무엇이 어떻게 다른지 적는다', () => {
    const r = matchExpectedBody('{"n":"열"}', declare(f('n', 'number', 'required')))
    expect(r.verdict).toBe('mismatch')
    expect(r.issues[0].detail).toContain('number')
    expect(r.issues[0].detail).toContain('string')
  })

  it('nullable 로 선언한 것이 이번에 없는 것은 어긋남이 아니다', () => {
    expect(matchExpectedBody('{}', declare(f('memo', 'string', 'nullable'))).verdict).toBe('match')
  })

  it('필수여부 `모름`은 대조에서 빠지고 **몇 개 뺐는지** 결과에 실린다', () => {
    const r = matchExpectedBody('{}', declare(f('maybe', 'string', 'unknown')))
    expect(r.verdict).toBe('match')
    expect(r.skippedUnknown).toBe(1)
  })

  it('선언에 없는 필드가 더 와도 어긋남이 아니다 — 발신자는 남이고 필드를 더할 수 있다', () => {
    const r = matchExpectedBody('{"id":"x","extra":1}', declare(f('id', 'string', 'required')))
    expect(r.verdict).toBe('match')
  })

  it('중첩 객체 안까지 경로와 함께 들어간다', () => {
    const nested: FieldDef = {
      name: 'user',
      type: 'object',
      requiredness: 'required',
      fields: [f('email', 'string', 'required')]
    }
    const r = matchExpectedBody('{"user":{"email":1}}', declare(nested))
    expect(r.issues[0].path).toBe('user.email')
  })

  it('필수로 선언한 것이 null 로 오면 어긋남이다', () => {
    const r = matchExpectedBody('{"id":null}', declare(f('id', 'string', 'required')))
    expect(r.verdict).toBe('mismatch')
    expect(r.issues[0].detail).toContain('null')
  })

  it('선언 텍스트 읽기는 배열만 받아들인다', () => {
    expect(parseExpected(declare(f('a', 'string', 'required')))).toHaveLength(1)
    expect(parseExpected('null')).toBeNull()
    expect(parseExpected(undefined)).toBeNull()
  })
})

// ── CASE-apirunner-044 ────────────────────────────────────────────────────

describe('포트 충돌 (CASE-apirunner-044)', () => {
  it('쓰는 포트면 다음 빈 포트를 제안한다', () => {
    const busy = new Set([7799, 7800])
    expect(suggestPort(7799, (p) => busy.has(p))).toBe(7801)
  })

  it('**자동으로 옮겨 붙지 않는다** — 제안만 하고 고르는 건 사람이다', () => {
    // 이 함수는 숫자만 돌려준다. 여는 일은 호출부가 사람 조작을 받아 한다.
    expect(typeof suggestPort(7799, () => false)).toBe('number')
  })

  it('가까운 데 빈 포트가 없으면 지어내지 않고 null 을 준다', () => {
    expect(suggestPort(7799, () => true)).toBeNull()
  })

  it('포트 상한을 넘겨 제안하지 않는다', () => {
    expect(suggestPort(65_535, () => false)).toBeNull()
  })

  it('기본 포트가 흔한 개발 서버 포트와 겹치지 않는다', () => {
    expect([3000, 5173, 8080, 8000, 5000]).not.toContain(DEFAULT_INBOX_PORT)
  })

  it('수신 주소는 **로컬 고정**이다 — 외부에서 닿는 주소를 만들 수 없다 (AC-3)', () => {
    expect(inboxUrl(7799)).toBe('http://127.0.0.1:7799/')
  })
})

// ── CASE-apirunner-046 · 047 ──────────────────────────────────────────────

const received = (over: Partial<ReceivedRequest> = {}): ReceivedRequest => ({
  id: 'rcv_1',
  at: '2026-07-29T00:00:01.000Z',
  method: 'POST',
  path: '/hooks/paid?try=2',
  headers: { 'content-type': 'application/json' },
  body: '{"id":"evt_1"}',
  size: 14,
  respondedWith: 200,
  match: { verdict: 'match', issues: [], skippedUnknown: 0 },
  ...over
})

describe('수신 목록 행 (CASE-apirunner-046)', () => {
  it('메서드·경로·크기·시각이 담긴다', () => {
    const row = receivedRow(received())
    expect(row).toEqual({
      id: 'rcv_1',
      at: '2026-07-29T00:00:01.000Z',
      method: 'POST',
      path: '/hooks/paid?try=2',
      size: 14,
      verdict: 'match'
    })
  })

  it('대조 결과가 행에 실린다 — 열어 보지 않아도 어긋난 것이 눈에 든다', () => {
    expect(receivedRow(received({ match: { verdict: 'undeclared', issues: [], skippedUnknown: 0 } })).verdict).toBe(
      'undeclared'
    )
  })
})

describe('수신 → Run (CASE-apirunner-047)', () => {
  const run = () =>
    receivedToRun({
      specId: 's1',
      requestName: 'onPaid',
      environmentId: 'e1',
      environmentName: 'DEV',
      baseVersion: 'v1',
      received: received()
    })

  it('수신 하나가 Run 하나가 된다 — 웹훅도 관측 기록이다', () => {
    expect(run().requestName).toBe('onPaid')
    expect(run().shape).toBe('inbound')
  })

  it('**방향이 반대라 칸의 뜻도 반대다** — `request` 가 들어온 것이다', () => {
    const r = run()
    expect(r.request.method).toBe('POST')
    expect(r.request.url).toBe('/hooks/paid?try=2')
    expect(r.request.body).toBe('{"id":"evt_1"}')
    expect(r.request.headers['content-type']).toBe('application/json')
  })

  it('우리가 되돌려준 코드가 응답 자리에 남는다', () => {
    expect(run().response?.status).toBe(200)
    expect(run().httpStatus).toBe(200)
  })

  it('기준 버전이 실린다 — 어느 버전 기준의 관측인지 판정이 가른다', () => {
    expect(run().baseVersion).toBe('v1')
  })

  it('대조 결과가 관측 내용에 남는다 — 나중에 왜 어긋났는지 되짚을 수 있다', () => {
    const r = receivedToRun({
      specId: 's1',
      requestName: 'onPaid',
      environmentId: 'e1',
      environmentName: 'DEV',
      baseVersion: null,
      received: received({
        match: { verdict: 'mismatch', issues: [{ path: 'id', detail: '없습니다.' }], skippedUnknown: 2 }
      })
    })
    const note = r.messages?.find((m) => m.event === 'match')?.data ?? ''
    expect(note).toContain('선언과 어긋남')
    expect(note).toContain('id')
    expect(note).toContain('모름 2개 제외')
  })

  it('대조가 어긋나도 **수신 자체는 성공**이다 — 둘은 다른 축이다', () => {
    const r = receivedToRun({
      specId: 's1',
      requestName: 'onPaid',
      environmentId: 'e1',
      environmentName: 'DEV',
      baseVersion: null,
      received: received({ match: { verdict: 'mismatch', issues: [], skippedUnknown: 0 } })
    })
    expect(r.status).toBe('ok')
  })
})

describe('수신 대기를 걸 수 있는 요청', () => {
  const req = (name: string, shape: RequestDef['shape']): RequestDef => ({
    id: name,
    name,
    folder: '',
    shape,
    params: [],
    request: {},
    responses: [],
    docs: ''
  })

  it('`inbound` 모양만이다 — 보내는 요청에 수신 대기를 걸 수 없다', () => {
    const got = inboundRequests([req('a', 'unary'), req('b', 'inbound'), req('c', 'duplex')])
    expect(got.map((r) => r.name)).toEqual(['b'])
  })
})
