import { describe, expect, it } from 'vitest'
import { PATCH_OP_NAMES, applyPatch, type PatchOp } from './patch'
import type { SpecDef } from './types'

/** 명세 부분 수정 — `docs/qa/api-mcp.md` S4 (CASE-apimcp-033~035, 037). */

const base = (): SpecDef => ({
  id: 's1',
  name: 'S',
  description: '',
  docs: '',
  kind: 'rest',
  requests: [
    {
      id: 'keep-me',
      name: 'getUser',
      folder: 'users',
      shape: 'unary',
      params: [{ name: 'id', type: 'string', required: true }],
      request: { method: 'GET', path: '/users/{{id}}' },
      responses: [{ status: '200', fields: [{ name: 'id', type: 'string', requiredness: 'required' }] }],
      docs: '옛 문서'
    }
  ]
})

const ids = () => {
  let n = 0
  return () => `new_${++n}`
}

// CASE-apimcp-035 — 연산 전종
describe('CASE-apimcp-035 연산 전종이 Draft 를 올바르게 바꾼다', () => {
  it('선언된 연산 이름이 실제 구현과 일치한다 (spec tools.write AC-4)', () => {
    expect([...PATCH_OP_NAMES].sort()).toEqual(
      [
        'add_param',
        'add_request',
        'remove_param',
        'remove_request',
        'rename_request',
        'set_docs',
        'set_request_fields',
        'set_response_schema',
        'update_param'
      ].sort()
    )
  })

  it('add_request / remove_request / rename_request', () => {
    const a = applyPatch(base(), [{ op: 'add_request', name: 'listUsers' }], ids())
    expect(a.spec.requests.map((r) => r.name)).toEqual(['getUser', 'listUsers'])
    expect(a.spec.requests[1].id).toBe('new_1')

    const b = applyPatch(base(), [{ op: 'rename_request', name: 'getUser', to: 'fetchUser' }])
    expect(b.spec.requests[0].name).toBe('fetchUser')

    const c = applyPatch(base(), [{ op: 'remove_request', name: 'getUser' }])
    expect(c.spec.requests).toEqual([])
  })

  it('모양을 안 적으면 그 인터페이스의 첫 모양이 기본이다 — unary 로 박지 않는다', () => {
    // 'unary' 로 박아 두면 SSE·WebSocket 명세에서 저장이 통째로 거부된다(그 종류에 없는 모양).
    expect(applyPatch(base(), [{ op: 'add_request', name: 'x' }]).spec.requests[1].shape).toBe('unary')

    const sse = { ...base(), kind: 'sse' as const, requests: [] }
    expect(applyPatch(sse, [{ op: 'add_request', name: 'ticker' }]).spec.requests[0].shape).toBe('server-stream')

    const ws = { ...base(), kind: 'websocket' as const, requests: [] }
    expect(applyPatch(ws, [{ op: 'add_request', name: 'chat' }]).spec.requests[0].shape).toBe('duplex')
  })

  it('적은 모양은 그대로 존중한다', () => {
    const grpc = { ...base(), kind: 'grpc' as const, requests: [] }
    const r = applyPatch(grpc, [{ op: 'add_request', name: 'feed', shape: 'server-stream' }])
    expect(r.spec.requests[0].shape).toBe('server-stream')
  })

  it('set_docs 는 문서만 바꾼다', () => {
    const out = applyPatch(base(), [{ op: 'set_docs', request: 'getUser', docs: '새 문서' }])
    expect(out.spec.requests[0].docs).toBe('새 문서')
    expect(out.spec.requests[0].params).toEqual(base().requests[0].params)
  })

  it('add_param / update_param / remove_param', () => {
    const a = applyPatch(base(), [
      { op: 'add_param', request: 'getUser', param: { name: 'expand', type: 'boolean', required: false } }
    ])
    expect(a.spec.requests[0].params.map((p) => p.name)).toEqual(['id', 'expand'])

    const b = applyPatch(base(), [
      { op: 'update_param', request: 'getUser', name: 'id', patch: { required: false, description: '설명' } }
    ])
    expect(b.spec.requests[0].params[0]).toEqual({
      name: 'id',
      type: 'string',
      required: false,
      description: '설명'
    })

    const c = applyPatch(base(), [{ op: 'remove_param', request: 'getUser', name: 'id' }])
    expect(c.spec.requests[0].params).toEqual([])
  })

  it('set_request_fields / set_response_schema (있으면 덮고 없으면 더한다)', () => {
    const a = applyPatch(base(), [
      { op: 'set_request_fields', request: 'getUser', fields: { method: 'POST', path: '/u' } }
    ])
    expect(a.spec.requests[0].request).toEqual({ method: 'POST', path: '/u' })

    const b = applyPatch(base(), [
      { op: 'set_response_schema', request: 'getUser', status: '200', fields: [] },
      { op: 'set_response_schema', request: 'getUser', status: '404', fields: [] }
    ])
    expect(b.spec.requests[0].responses.map((r) => r.status)).toEqual(['200', '404'])
    expect(b.spec.requests[0].responses[0].fields).toEqual([])
  })

  it('바뀐 것을 한 줄씩 돌려준다', () => {
    const out = applyPatch(base(), [
      { op: 'set_docs', request: 'getUser', docs: 'x' },
      { op: 'add_request', name: 'b' }
    ], ids())
    expect(out.changes).toEqual(['문서 수정: getUser', '요청 추가: b'])
  })
})

// CASE-apimcp-034 — 이름 조준 · id 보존
describe('CASE-apimcp-034 이름으로 조준하고 손대지 않은 것은 id 까지 보존한다', () => {
  it('내부 id 를 몰라도 이름만으로 고칠 수 있다', () => {
    const out = applyPatch(base(), [{ op: 'set_docs', request: 'getUser', docs: 'x' }])
    expect(out.spec.requests[0].id).toBe('keep-me')
  })

  it('이름을 바꿔도 id 는 그대로다 — 버전 diff 가 짝을 잃지 않는다', () => {
    const out = applyPatch(base(), [{ op: 'rename_request', name: 'getUser', to: 'other' }])
    expect(out.spec.requests[0].id).toBe('keep-me')
  })

  it('원본을 건드리지 않는다 (사본에만 적용)', () => {
    const original = base()
    applyPatch(original, [{ op: 'remove_request', name: 'getUser' }])
    expect(original.requests).toHaveLength(1)
  })
})

// CASE-apimcp-033 — 원자성 · 위치 밝히기
describe('CASE-apimcp-033 원자 적용', () => {
  it('하나라도 실패하면 전부 미반영이다', () => {
    const spec = base()
    const ops: PatchOp[] = [
      { op: 'set_docs', request: 'getUser', docs: '바뀌면 안 됨' },
      { op: 'set_docs', request: '없는요청', docs: 'x' }
    ]
    expect(() => applyPatch(spec, ops)).toThrow()
    expect(spec.requests[0].docs).toBe('옛 문서')
  })

  it('몇 번째 연산인지 밝힌다 (1부터)', () => {
    expect(() =>
      applyPatch(base(), [{ op: 'set_docs', request: 'getUser', docs: 'a' }, { op: 'remove_request', name: 'nope' }])
    ).toThrow(/연산 2번/)
  })

  it('없는 이름에는 쓸 수 있는 이름 목록을 함께 준다', () => {
    expect(() => applyPatch(base(), [{ op: 'remove_param', request: 'getUser', name: 'nope' }])).toThrow(/id/)
    expect(() => applyPatch(base(), [{ op: 'set_docs', request: 'nope', docs: '' }])).toThrow(/getUser/)
  })

  it('중복을 만드는 연산을 막는다', () => {
    expect(() => applyPatch(base(), [{ op: 'add_request', name: 'getUser' }])).toThrow(/이미 있습니다/)
    expect(() =>
      applyPatch(base(), [{ op: 'add_param', request: 'getUser', param: { name: 'id', type: 'string', required: true } }])
    ).toThrow(/이미 있습니다/)
  })

  it('모르는 연산은 허용 목록과 함께 거부한다', () => {
    expect(() => applyPatch(base(), [{ op: 'drop_everything' } as unknown as PatchOp])).toThrow(/add_request/)
  })
})

// CASE-apimcp-037 — 그릇 보존
describe('CASE-apimcp-037 그릇은 못 없앤다', () => {
  it('요청은 지울 수 있지만 명세 자체를 없애는 연산은 목록에 없다', () => {
    expect(PATCH_OP_NAMES).toContain('remove_request')
    expect(PATCH_OP_NAMES.some((o) => /spec|environment/.test(o))).toBe(false)
  })

  it('명세의 id·이름·종류는 어떤 연산으로도 안 바뀐다', () => {
    const out = applyPatch(base(), [
      { op: 'add_request', name: 'x' },
      { op: 'remove_request', name: 'getUser' }
    ], ids())
    expect({ id: out.spec.id, name: out.spec.name, kind: out.spec.kind }).toEqual({
      id: 's1',
      name: 'S',
      kind: 'rest'
    })
  })
})
