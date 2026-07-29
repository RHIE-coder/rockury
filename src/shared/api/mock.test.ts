import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOCK_PORT,
  matchRoute,
  mockBody,
  mockUnsupportedReason,
  mockableRequests,
  pathMatches,
  pickResponse
} from './mock'
import { DEFAULT_INBOX_PORT } from './inbox'
import type { FieldDef, RequestDef, SpecDef } from './types'

/** TestPlan: api-studio · CASE-apistudio-090~095 (mocking.server). */

const f = (
  name: string,
  type: FieldDef['type'],
  requiredness: FieldDef['requiredness'] = 'required',
  over: Partial<FieldDef> = {}
): FieldDef => ({ name, type, requiredness, ...over })

const req = (name: string, over: Partial<RequestDef> = {}): RequestDef => ({
  id: name,
  name,
  folder: '',
  shape: 'unary',
  params: [],
  request: { method: 'GET', path: `/${name}` },
  responses: [],
  docs: '',
  ...over
})

const spec = (requests: RequestDef[], kind: SpecDef['kind'] = 'rest'): SpecDef => ({
  id: 's1',
  name: 'S',
  description: '',
  kind,
  requests
})

const parse = (r: ReturnType<typeof mockBody>): Record<string, unknown> => JSON.parse(r.body)

describe('가짜 본문 만들기', () => {
  it('선언한 타입대로 만든다', () => {
    const b = mockBody({ status: '200', fields: [f('id', 'string'), f('n', 'number'), f('ok', 'boolean')] })
    expect(parse(b)).toEqual({ id: '(mock:id)', n: 0, ok: false })
  })

  it('**값이 일부러 가짜처럼 보인다** — 진짜 같으면 스크린샷이 "이미 되는 것"으로 돌아다닌다', () => {
    expect(parse(mockBody({ status: '200', fields: [f('email', 'string')] })).email).toBe('(mock:email)')
  })

  it('허용 값이 있으면 그 값을 쓴다 — 그건 우리가 **아는** 값이다', () => {
    const b = mockBody({ status: '200', fields: [f('order', 'string', 'required', { enumValues: ['asc', 'desc'] })] })
    expect(parse(b).order).toBe('asc')
  })

  it('**없을 수 있다고 선언한 것은 null 로 낸다** — 값을 지어내면 프론트가 null 경로를 안 짠다', () => {
    expect(parse(mockBody({ status: '200', fields: [f('memo', 'string', 'nullable')] })).memo).toBeNull()
  })

  it('`모름` 은 내되 **몇 개를 짐작했는지** 함께 알린다', () => {
    const b = mockBody({ status: '200', fields: [f('maybe', 'string', 'unknown'), f('sure', 'string')] })
    expect(b.guessed).toBe(1)
    expect(parse(b)).toEqual({ maybe: '(mock:maybe)', sure: '(mock:sure)' })
  })

  it('짐작이 없으면 0 이다 — 없는 것과 0 은 다르다', () => {
    expect(mockBody({ status: '200', fields: [f('id', 'string')] }).guessed).toBe(0)
  })

  it('중첩 객체 안까지 만든다', () => {
    const nested = f('user', 'object', 'required', { fields: [f('email', 'string')] })
    expect(parse(mockBody({ status: '200', fields: [nested] }))).toEqual({
      user: { email: '(mock:email)' }
    })
  })

  it('배열은 원소 하나만 낸다 — 몇 개가 오는지는 선언에 없다', () => {
    const arr = f('tags', 'array', 'required', { fields: [f('name', 'string')] })
    expect(parse(mockBody({ status: '200', fields: [arr] }))).toEqual({ tags: [{ name: '(mock:name)' }] })
  })

  it('원소 모양을 모르는 배열은 빈 배열이다 — 원소를 지어내지 않는다', () => {
    expect(parse(mockBody({ status: '200', fields: [f('tags', 'array')] }))).toEqual({ tags: [] })
  })

  it('루트가 배열인 응답(`[]` 표식)도 배열로 낸다', () => {
    const root = f('[]', 'array', 'required', { fields: [f('id', 'string')] })
    expect(JSON.parse(mockBody({ status: '200', fields: [root] }).body)).toEqual([{ id: '(mock:id)' }])
  })

  it('`[]` 표식을 객체 키로 만들지 않는다', () => {
    const nested = f('page', 'object', 'required', {
      fields: [f('[]', 'array', 'required', { fields: [f('id', 'string')] })]
    })
    const out = parse(mockBody({ status: '200', fields: [nested] }))
    expect(Object.keys(out.page as object)).toEqual([])
  })

  it('필드가 없으면 빈 객체다 — 없는 필드를 지어내지 않는다', () => {
    expect(parse(mockBody({ status: '200', fields: [] }))).toEqual({})
  })
})

describe('경로 대조', () => {
  it('치환 자리는 아무 조각이나 받는다 — 그 값이 뭘지는 선언에 없다', () => {
    expect(pathMatches('/users/{{userId}}', '/users/42')).toBe(true)
    expect(pathMatches('/users/{{userId}}', '/users/abc')).toBe(true)
  })

  it('조각 수가 다르면 안 맞는다', () => {
    expect(pathMatches('/users/{{id}}', '/users')).toBe(false)
    expect(pathMatches('/users/{{id}}', '/users/1/orders')).toBe(false)
  })

  it('고정 조각은 정확히 같아야 한다', () => {
    expect(pathMatches('/users/{{id}}', '/people/1')).toBe(false)
  })

  it('쿼리는 대조에서 뺀다 — 경로가 아니다', () => {
    expect(pathMatches('/orders', '/orders?page=2')).toBe(true)
  })

  it('앞뒤 슬래시 차이로 안 갈린다', () => {
    expect(pathMatches('orders', '/orders/')).toBe(true)
  })
})

describe('응답 고르기', () => {
  const withStatuses = (...statuses: string[]): RequestDef =>
    req('a', { responses: statuses.map((s) => ({ status: s, fields: [] })) })

  it('기본은 가장 낮은 2xx 다', () => {
    expect(pickResponse(withStatuses('404', '201', '200')).response?.status).toBe('200')
  })

  it('2xx 가 없으면 첫 선언을 쓴다', () => {
    expect(pickResponse(withStatuses('404', '500')).response?.status).toBe('404')
  })

  it('골라 둔 상태가 이긴다 — 오류 경로를 짜 보려면 4xx 를 낼 수 있어야 한다', () => {
    expect(pickResponse(withStatuses('200', '404'), '404').response?.status).toBe('404')
  })

  it('선언 안 한 상태를 고르면 지어내지 않고 사유를 준다', () => {
    const m = pickResponse(withStatuses('200'), '418')
    expect(m.response).toBeNull()
    expect(m.unavailable).toContain('418')
  })

  it('**선언이 아예 없으면 가짜 본문을 안 만든다** — 없는 계약 위에 화면을 짓게 된다', () => {
    const m = pickResponse(req('a'))
    expect(m.response).toBeNull()
    expect(m.unavailable).toContain('응답 모양 선언이 없어')
    expect(m.unavailable).toContain('Studio')
  })
})

describe('무엇을 흉내 내나', () => {
  it('REST 단발 요청만 대상이다', () => {
    const s = spec([req('a'), { ...req('b'), shape: 'inbound' }])
    expect(mockableRequests(s).map((r) => r.name)).toEqual(['a'])
  })

  it('**REST 가 아니면 흉내 내지 않고 사유를 준다** — 엉뚱한 응답을 주느니 안 하는 게 낫다', () => {
    expect(mockableRequests(spec([req('a')], 'graphql'))).toEqual([])
    expect(mockUnsupportedReason(spec([], 'graphql'))).toContain('경로+메서드로 갈리지 않아서')
    expect(mockUnsupportedReason(spec([], 'rest'))).toBeNull()
  })
})

describe('길 찾기', () => {
  const s = spec([
    req('getUser', {
      request: { method: 'GET', path: '/users/{{id}}' },
      responses: [{ status: '200', fields: [f('id', 'string')] }]
    }),
    req('createUser', {
      request: { method: 'POST', path: '/users' },
      responses: [{ status: '201', fields: [] }]
    })
  ])

  it('메서드와 경로가 함께 맞아야 한다', () => {
    expect(matchRoute(s, 'GET', '/users/42')?.request.name).toBe('getUser')
    expect(matchRoute(s, 'POST', '/users')?.request.name).toBe('createUser')
    expect(matchRoute(s, 'DELETE', '/users/42')).toBeNull()
  })

  it('아무 선언과도 안 맞으면 null 이다 — 아무거나 답하지 않는다', () => {
    expect(matchRoute(s, 'GET', '/unknown')).toBeNull()
  })

  it('골라 둔 상태가 길 찾기까지 따라온다', () => {
    const withError = spec([
      req('getUser', {
        request: { method: 'GET', path: '/users/{{id}}' },
        responses: [
          { status: '200', fields: [] },
          { status: '404', fields: [] }
        ]
      })
    ])
    expect(matchRoute(withError, 'GET', '/users/1', { getUser: '404' })?.response?.status).toBe('404')
  })
})

describe('포트', () => {
  it('Inbox 와 안 겹친다 — 둘 다 켜 둘 수 있어야 한다', () => {
    expect(DEFAULT_MOCK_PORT).not.toBe(DEFAULT_INBOX_PORT)
  })
})
