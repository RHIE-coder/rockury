import { describe, expect, it } from 'vitest'
import { envHealth, refsOfRequest } from './envHealth'
import type { EnvValue, RequestDef } from './types'

/** TestPlan: api-runner · CASE-apirunner-012 (values AC-4). */

const req = (over: Partial<RequestDef> = {}): RequestDef => ({
  id: 'r1',
  name: 'getUser',
  folder: '',
  shape: 'unary',
  params: [],
  request: {},
  responses: [],
  docs: '',
  ...over
})

const val = (name: string, value: string): EnvValue => ({ name, value, secret: false })

describe('참조 수집', () => {
  it('경로·헤더 값·본문의 참조를 모두 훑는다', () => {
    const r = req({
      request: {
        path: '/users/{{userId}}',
        headers: { Authorization: 'Bearer {{apiKey}}' },
        body: '{"tenant":"{{tenantId}}"}'
      }
    })
    expect(refsOfRequest(r).sort()).toEqual(['apiKey', 'tenantId', 'userId'])
  })

  it('쿼리는 **값만** 훑는다 — 이름은 템플릿이 아니다', () => {
    expect(refsOfRequest(req({ request: { query: { page: '{{page}}' } } })).sort()).toEqual(['page'])
  })

  it('파라미터 기본값 안의 참조도 센다', () => {
    const r = req({ params: [{ name: 'region', type: 'string', required: false, defaultValue: '{{defaultRegion}}' }] })
    expect(refsOfRequest(r)).toEqual(['defaultRegion'])
  })

  it('함수 안에 든 참조도 센다', () => {
    expect(refsOfRequest(req({ request: { headers: { Sig: '{{hmac("sha256", secret, path)}}' } } }))).toContain(
      'secret'
    )
  })

  it('깨진 표현은 이름을 못 뽑을 뿐 터지지 않는다', () => {
    expect(() => refsOfRequest(req({ request: { path: '/a/{{ (( }}' } }))).not.toThrow()
  })
})

describe('고아·구멍 판정 (CASE-apirunner-012)', () => {
  const requests = [
    req({ name: 'a', request: { path: '/u/{{userId}}', headers: { Auth: '{{apiKey}}' } } })
  ]

  it('어느 요청도 안 쓰는 값은 고아다', () => {
    const h = envHealth(requests, [val('apiKey', 'k'), val('legacyToken', 'x')])
    expect(h.orphans).toEqual(['legacyToken'])
  })

  it('참조되는데 값이 비면 구멍이다', () => {
    const h = envHealth(requests, [val('apiKey', '')])
    expect(h.holes).toEqual(['apiKey'])
  })

  it('**둘 다 아닌 것은 목록에 안 나온다** — 정상인 것을 나열하면 아무도 안 읽는다', () => {
    const h = envHealth(requests, [val('apiKey', 'k')])
    expect(h).toEqual({ orphans: [], holes: [] })
  })

  it('고아이면서 값이 빈 것은 고아로만 센다 — 안 쓰는 값이 빈 건 문제가 아니다', () => {
    const h = envHealth(requests, [val('unused', '')])
    expect(h.orphans).toEqual(['unused'])
    expect(h.holes).toEqual([])
  })

  it('여러 요청이 함께 쓰는 값은 고아가 아니다', () => {
    const two = [req({ name: 'a', request: { path: '/{{shared}}' } }), req({ name: 'b', request: {} })]
    expect(envHealth(two, [val('shared', 'v')]).orphans).toEqual([])
  })

  it('요청이 하나도 없으면 모든 값이 고아다', () => {
    expect(envHealth([], [val('apiKey', 'k')]).orphans).toEqual(['apiKey'])
  })

  it('파라미터로만 채워지는 이름은 환경 값 판정에 안 섞인다', () => {
    // `{{userId}}` 는 파라미터가 채우는 자리다 — 환경에 같은 이름이 없으면 여기 결과에 안 나온다.
    expect(envHealth(requests, [val('apiKey', 'k')])).toEqual({ orphans: [], holes: [] })
  })
})
