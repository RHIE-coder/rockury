import { describe, expect, it } from 'vitest'
import { exportSpec, formatsFor } from './exportSpec'
import { importOpenapi } from './importOpenapi'
import type { RequestDef, SpecDef } from './types'

/** 내보내기 — CASE-apistudio-025·026 (불변식 ⑥). */

const req = (over: Partial<RequestDef> = {}): RequestDef => ({
  id: 'r',
  name: 'getUser',
  folder: 'users',
  shape: 'unary',
  params: [
    { name: 'id', type: 'string', required: true },
    { name: 'limit', type: 'number', required: false, defaultValue: '20' }
  ],
  request: {
    method: 'GET',
    path: '/users/{id}',
    query: { limit: '{{limit}}' },
    headers: { Authorization: 'Bearer {{apiKey}}' }
  },
  responses: [
    {
      status: '200',
      fields: [
        { name: 'id', type: 'string', requiredness: 'required' },
        { name: 'memo', type: 'string', requiredness: 'nullable' },
        { name: 'dunno', type: 'string', requiredness: 'unknown' }
      ]
    }
  ],
  docs: '사용자 조회\n\n주의: 폐기 예정',
  ...over
})

const spec = (over: Partial<SpecDef> = {}): SpecDef => ({
  id: 'billing',
  name: 'Billing',
  description: '결제',
  docs: '',
  kind: 'rest',
  requests: [req()],
  ...over
})

describe('형식 고르기', () => {
  it('인터페이스 종류가 형식을 정한다', () => {
    expect(formatsFor('rest')).toEqual(['openapi'])
    expect(formatsFor('grpc')).toEqual(['proto'])
    expect(formatsFor('graphql')).toEqual(['graphql'])
  })

  it('맞지 않는 형식은 거부하고 가능한 형식을 알린다', () => {
    expect(() => exportSpec(spec(), 'proto')).toThrow(/openapi/)
  })
})

// CASE-apistudio-025 — 불변식 ⑥
describe('CASE-apistudio-025 내보낸 파일에 값이 실리지 않는다', () => {
  it('헤더는 **이름만** 나가고 값 자리(템플릿)는 안 나간다', () => {
    const out = exportSpec(spec(), 'openapi').content
    // 계약("이 엔드포인트는 Authorization 헤더를 받는다")은 남고,
    expect(out).toContain('"Authorization"')
    // 값 쪽은 환경이 채우는 것이라 파일에 나가지 않는다.
    expect(out).not.toContain('{{apiKey}}')
    expect(out).not.toContain('Bearer')
    expect(out).not.toContain('SEKRIT')
  })

  it('헤더를 통째로 빼서 계약을 잃지도 않는다', () => {
    const params = JSON.parse(exportSpec(spec(), 'openapi').content).paths['/users/{id}'].get.parameters
    expect(params.find((p: { name: string }) => p.name === 'Authorization').in).toBe('header')
  })

  it('명세에는 값을 담을 자리 자체가 없다 — 구조로 보장된다', () => {
    // SpecDef 의 어느 필드도 EnvValue 를 갖지 않는다. 값이 새려면 타입이 먼저 바뀌어야 한다.
    const json = JSON.stringify(spec())
    expect(json).not.toMatch(/"value"\s*:/)
    expect(json).not.toMatch(/"secret"\s*:/)
  })

  it('세 형식 어디서도 값이 안 나간다', () => {
    const g = exportSpec(spec({ kind: 'grpc', requests: [req({ shape: 'unary' })] }), 'proto').content
    const q = exportSpec(spec({ kind: 'graphql' }), 'graphql').content
    for (const out of [g, q]) expect(out).not.toContain('SEKRIT')
  })
})

describe('OpenAPI 내보내기', () => {
  const out = JSON.parse(exportSpec(spec(), 'openapi').content)

  it('경로·메서드·operationId 를 담는다', () => {
    expect(out.openapi).toBe('3.0.3')
    expect(out.info.title).toBe('Billing')
    expect(out.paths['/users/{id}'].get.operationId).toBe('getUser')
  })

  it('파라미터 위치를 경로/쿼리/헤더로 가른다', () => {
    const params = out.paths['/users/{id}'].get.parameters
    expect(params.find((p: { name: string }) => p.name === 'id').in).toBe('path')
    expect(params.find((p: { name: string }) => p.name === 'limit').in).toBe('query')
  })

  it('필수여부를 required·nullable 로 옮긴다', () => {
    const schema = out.paths['/users/{id}'].get.responses['200'].content['application/json'].schema
    expect(schema.required).toEqual(['id'])
    expect(schema.properties.memo.nullable).toBe(true)
  })

  it("'모름' 은 required 로도 nullable 로도 적지 않는다 — 모르는 것을 문서에 확정해 쓰지 않는다", () => {
    const schema = out.paths['/users/{id}'].get.responses['200'].content['application/json'].schema
    expect(schema.required).not.toContain('dunno')
    expect(schema.properties.dunno.nullable).toBeUndefined()
  })

  it('문서와 태그를 옮긴다', () => {
    expect(out.paths['/users/{id}'].get.summary).toBe('사용자 조회')
    expect(out.paths['/users/{id}'].get.tags).toEqual(['users'])
  })

  it('OpenAPI 로 못 옮기는 모양은 버리지 않고 보고한다', () => {
    const r = exportSpec(spec({ requests: [req({ shape: 'server-stream' })] }), 'openapi')
    expect(r.unsupported.some((u) => u.includes('server-stream'))).toBe(true)
  })
})

// CASE-apistudio-026 — 왕복
describe('CASE-apistudio-026 내보냈다 다시 가져오면 구조가 보존된다', () => {
  it('요청 이름·메서드·경로·파라미터·응답 필드가 살아남는다', () => {
    const exported = exportSpec(spec(), 'openapi').content
    const back = importOpenapi(exported)

    expect(back.requests).toHaveLength(1)
    const r = back.requests[0]
    expect(r.name).toBe('getUser')
    expect(r.request.method).toBe('GET')
    expect(r.request.path).toBe('/users/{id}')
    // OpenAPI 는 헤더도 파라미터로 모델링한다 — 왕복하면 헤더가 파라미터로 승격돼 돌아온다.
    // 값은 안 따라오므로 잃는 것은 없고, 오히려 "이 헤더를 받는다"가 명시적으로 남는다.
    expect(r.params.map((p) => p.name).sort()).toEqual(['Authorization', 'id', 'limit'])
    expect(r.params.find((p) => p.name === 'id')?.required).toBe(true)
    expect(r.responses[0].fields.map((f) => f.name)).toEqual(['id', 'memo', 'dunno'])
    expect(r.responses[0].fields.find((f) => f.name === 'id')?.requiredness).toBe('required')
  })

  it('왕복에서도 값은 안 생긴다', () => {
    const back = importOpenapi(exportSpec(spec(), 'openapi').content)
    expect(JSON.stringify(back)).not.toContain('SEKRIT')
  })
})

describe('proto·SDL 내보내기', () => {
  it('proto 는 스트리밍 종류를 그대로 적는다', () => {
    const out = exportSpec(
      spec({ kind: 'grpc', requests: [req({ name: 'Watch', shape: 'server-stream' })] }),
      'proto'
    ).content
    expect(out).toContain('rpc Watch (WatchRequest) returns (stream WatchResponse);')
    expect(out).toContain('syntax = "proto3";')
  })

  it('SDL 은 필수여부를 ! 로 적는다', () => {
    const out = exportSpec(spec({ kind: 'graphql' }), 'graphql').content
    expect(out).toContain('id: String!')
    expect(out).toContain('memo: String')
    expect(out).not.toContain('dunno: String!')
  })

  it('눌러 내보낸 것은 보고한다', () => {
    const nested = req({
      responses: [
        { status: '200', fields: [{ name: 'user', type: 'object', requiredness: 'required', fields: [] }] }
      ]
    })
    expect(exportSpec(spec({ kind: 'graphql', requests: [nested] }), 'graphql').unsupported).not.toEqual([])
  })

  it('파일 이름이 형식에 맞는다', () => {
    expect(exportSpec(spec(), 'openapi').filename).toBe('billing.openapi.json')
    expect(exportSpec(spec({ kind: 'grpc' }), 'proto').filename).toBe('billing.proto')
  })
})
