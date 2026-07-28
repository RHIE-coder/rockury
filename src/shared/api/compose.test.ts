import { describe, expect, it } from 'vitest'
import { composeRequest, toCurl } from './compose'
import { nodeFunctionEnv } from './nodeFunctionEnv'
import type { EnvironmentDef, RequestDef } from './types'

/**
 * 요청 조립 — `docs/qa/api-runner.md` S3 (CASE-apirunner-020~024) + 출처 표시(S1).
 * 여기가 "값이 어디서 왔나" 와 "보낼 수 있나" 를 한꺼번에 결정하는 자리다.
 */

const fns = { ...nodeFunctionEnv, now: () => Date.UTC(2026, 6, 28), uuid: () => 'fixed-uuid' }

const req = (over: Partial<RequestDef> = {}): RequestDef => ({
  id: 'r1',
  name: 'getUser',
  folder: '',
  shape: 'unary',
  params: [
    { name: 'userId', type: 'string', required: true },
    { name: 'limit', type: 'number', required: false, defaultValue: '20' }
  ],
  request: {
    method: 'GET',
    path: '/orgs/{{tenant}}/users/{{userId}}',
    query: { limit: '{{limit}}' },
    headers: { Authorization: 'Bearer {{apiKey}}' }
  },
  responses: [],
  docs: '',
  ...over
})

const env = (over: Partial<EnvironmentDef> = {}): EnvironmentDef => ({
  id: 'e1',
  specId: 's1',
  name: 'DEV',
  baseUrl: 'https://dev.example.com',
  production: false,
  values: [
    { name: 'tenant', value: 'acme', secret: false },
    { name: 'apiKey', value: 'SEKRIT', secret: true }
  ],
  ...over
})

const compose = (over: Parameters<typeof composeRequest>[0] extends infer T ? Partial<T> : never = {}) =>
  composeRequest({
    kind: 'rest',
    request: req(),
    env: env(),
    call: { userId: 'u_1' },
    functions: fns,
    ...over
  })

describe('CASE-apirunner-020 최종 요청 조립', () => {
  it('경로 치환 · 쿼리 · 헤더가 완성된다', () => {
    const c = compose()
    expect(c.method).toBe('GET')
    expect(c.url).toBe('https://dev.example.com/orgs/acme/users/u_1?limit=20')
    expect(c.headers.Authorization).toBe('Bearer SEKRIT')
  })

  it('쿼리 값을 URL 인코딩한다', () => {
    const c = compose({ call: { userId: 'a b&c' } })
    expect(c.url).toContain('/users/a%20b%26c')
  })

  it('baseUrl 과 경로의 슬래시가 겹치거나 빠져도 하나로 맞춘다', () => {
    expect(compose({ env: env({ baseUrl: 'https://x.test/' }) }).url).toContain('https://x.test/orgs')
    expect(
      compose({ request: req({ request: { method: 'GET', path: 'ping' } }), env: env({ baseUrl: 'https://x.test' }) }).url
    ).toBe('https://x.test/ping')
  })

  it('본문도 치환된다', () => {
    const c = compose({
      request: req({ request: { method: 'POST', path: '/u', body: '{"id":{{json(userId)}}}' } })
    })
    expect(c.body).toBe('{"id":"u_1"}')
    expect(c.method).toBe('POST')
  })

  it('빈 쿼리 값은 키만 남기지 않고 그대로 보낸다 (일부러 빈 값을 보낼 수 있어야 한다)', () => {
    const c = compose({
      request: req({ request: { method: 'GET', path: '/u', query: { q: '{{userId}}' } } }),
      call: { userId: '' }
    })
    expect(c.url).toBe('https://dev.example.com/u?q=')
  })
})

describe('CASE-apirunner-002 출처가 값에 붙어 다닌다', () => {
  it('쓴 값마다 어디서 왔는지 알려준다', () => {
    const c = compose()
    expect(c.origins).toEqual(
      expect.arrayContaining([
        { name: 'tenant', origin: 'environment', secret: false },
        { name: 'userId', origin: 'call', secret: false },
        { name: 'apiKey', origin: 'environment', secret: true },
        { name: 'limit', origin: 'default', secret: false }
      ])
    )
  })

  it('같은 값을 여러 자리에서 써도 한 번만 센다', () => {
    const c = compose({
      request: req({ request: { method: 'GET', path: '/{{tenant}}/{{tenant}}' } })
    })
    expect(c.origins.filter((o) => o.name === 'tenant')).toHaveLength(1)
  })
})

describe('CASE-apirunner-021 미리보기 마스킹', () => {
  it('미리보기에서는 비밀 표식 값이 가려진다', () => {
    const c = compose({ maskSecrets: true })
    expect(c.headers.Authorization).not.toContain('SEKRIT')
    expect(c.headers.Authorization).toContain('••••')
  })

  it('가려도 실제 전송용 조립은 실값을 쓴다 (같은 입력, 다른 목적)', () => {
    expect(compose({ maskSecrets: false }).headers.Authorization).toBe('Bearer SEKRIT')
  })
})

describe('CASE-apirunner-022 보낼 수 없는 조건은 조립 단계에서 막는다', () => {
  it('환경을 안 골랐으면 막힌다 (guard AC-1)', () => {
    const c = compose({ env: null })
    expect(c.canSend).toBe(false)
    expect(c.blocking.some((b) => b.kind === 'no-environment')).toBe(true)
  })

  it('필수 파라미터가 비면 막히고 이름을 지목한다', () => {
    const c = compose({ call: {} })
    expect(c.canSend).toBe(false)
    expect(c.blocking.find((b) => b.kind === 'param')?.where).toBe('userId')
  })

  it('해석 못 한 참조가 있으면 막히고 그 이름을 지목한다', () => {
    const c = compose({ env: env({ values: [] }) })
    expect(c.canSend).toBe(false)
    expect(c.blocking.map((b) => b.where)).toContain('tenant')
  })

  it('시그니처에 없는 값을 보내면 막는다 (오타가 조용히 무시되지 않는다)', () => {
    const c = compose({ call: { userId: 'u', usreId: 'u' } })
    expect(c.blocking.find((b) => b.kind === 'param')?.where).toBe('usreId')
  })

  it('문제가 없으면 보낼 수 있다', () => {
    expect(compose().canSend).toBe(true)
    expect(compose().blocking).toEqual([])
  })

  it('막혀도 미리보기는 만들어진다 — 어디가 문제인지 보여야 한다', () => {
    const c = compose({ env: env({ values: [] }) })
    expect(c.url).toContain('{{tenant}}')
  })
})

describe('CASE-apirunner-024 curl 생성', () => {
  it('실행 가능한 curl 을 만든다', () => {
    const c = compose()
    const curl = toCurl(c)
    expect(curl).toContain("curl -X GET 'https://dev.example.com/orgs/acme/users/u_1?limit=20'")
    expect(curl).toContain("-H 'Authorization: Bearer")
  })

  it('비밀 값은 실값이 아니라 변수 이름으로 남는다', () => {
    const curl = toCurl(compose())
    expect(curl).not.toContain('SEKRIT')
    expect(curl).toContain('$apiKey')
  })

  it('본문이 있으면 --data 로 붙는다', () => {
    const c = compose({ request: req({ request: { method: 'POST', path: '/u', body: '{"a":1}' } }) })
    expect(toCurl(c)).toContain("--data '{\"a\":1}'")
  })

  it('작은따옴표가 든 값도 셸에서 깨지지 않게 감싼다', () => {
    const c = compose({
      request: req({ request: { method: 'POST', path: '/u', body: "it's" } }),
      call: { userId: 'u' }
    })
    expect(toCurl(c)).toContain(`'it'\\''s'`)
  })
})

describe('스트리밍·수신 계열은 URL 만 조립한다', () => {
  it('SSE 는 접속 주소를 쓰고 메서드·본문이 없다', () => {
    const c = composeRequest({
      kind: 'sse',
      request: req({
        shape: 'server-stream',
        params: [],
        request: { connectUrl: '{{tenant}}/events', headers: {} }
      }),
      env: env(),
      call: {},
      functions: fns
    })
    expect(c.url).toBe('https://dev.example.com/acme/events')
    expect(c.body).toBe('')
  })
})
