import { describe, expect, it } from 'vitest'
import { previewAbsorb } from './absorb'
import type { FieldDef, RequestDef, RunRecord, SpecDef } from './types'

/** 흡수 — `docs/qa/api-contract.md` S4 (CASE-apicontract-030~033, 035). */

const f = (name: string, type: FieldDef['type'], requiredness: FieldDef['requiredness']): FieldDef => ({
  name,
  type,
  requiredness
})

const req = (name: string, responses: RequestDef['responses'] = []): RequestDef => ({
  id: name,
  name,
  folder: '',
  shape: 'unary',
  params: [],
  request: { method: 'GET', path: `/${name}` },
  responses,
  docs: ''
})

const spec = (requests: RequestDef[]): SpecDef => ({
  id: 's1',
  name: 'S',
  description: '',
  docs: '',
  kind: 'rest',
  requests
})

const run = (requestName: string, body: string, status = 200, createdAt = '2026-07-28T00:00:00.000Z'): RunRecord => ({
  id: `run_${requestName}_${createdAt}`,
  specId: 's1',
  requestName,
  environmentId: 'e1',
  environmentName: 'DEV',
  baseVersion: null,
  shape: 'unary',
  call: {},
  messages: null,
  messageCount: null,
  status: 'ok',
  httpStatus: status,
  durationMs: 1,
  createdAt,
  request: { method: 'GET', url: '/x', headers: {}, body: '' },
  response: { status, headers: {}, body, size: body.length },
  error: null
})

describe('CASE-apicontract-030~031 흡수는 더하기만 한다', () => {
  it('서버에만 있던 필드를 명세에 더한다', () => {
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [f('id', 'string', 'required')] }])]),
      runs: [run('a', '{"id":"x","extra":1}')]
    })
    expect(p.spec.requests[0].responses[0].fields.map((x) => x.name)).toEqual(['id', 'extra'])
    expect(p.changes.map((c) => c.path)).toEqual(['a.200.extra'])
  })

  it('이미 선언된 것은 타입도 필수여부도 손대지 않는다 — 실제가 옳다고 단정할 근거가 없다', () => {
    const declared = [f('id', 'string', 'required')]
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: declared }])]),
      runs: [run('a', '{"id":null}')]
    })
    expect(p.spec.requests[0].responses[0].fields[0]).toEqual(f('id', 'string', 'required'))
    expect(p.changes).toEqual([])
  })

  it('타입이 다른 필드는 흡수 대상이 아니다 (그건 "다름" 이고 사람이 판단한다)', () => {
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [f('n', 'number', 'required')] }])]),
      runs: [run('a', '{"n":"열"}')]
    })
    expect(p.spec.requests[0].responses[0].fields[0].type).toBe('number')
    expect(p.changes).toEqual([])
  })

  it('선언 없던 상태는 통째로 새로 만든다', () => {
    const p = previewAbsorb({ spec: spec([req('a')]), runs: [run('a', '{"x":1}', 404)] })
    expect(p.spec.requests[0].responses.map((r) => r.status)).toEqual(['404'])
    expect(p.changes[0].path).toBe('a.404')
  })

  it('중첩 필드도 따라 들어가 더한다', () => {
    const nested: FieldDef = {
      name: 'user',
      type: 'object',
      requiredness: 'required',
      fields: [f('id', 'string', 'required')]
    }
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [nested] }])]),
      runs: [run('a', '{"user":{"id":"x","email":"a@b"}}')]
    })
    expect(p.spec.requests[0].responses[0].fields[0].fields?.map((x) => x.name)).toEqual(['id', 'email'])
    expect(p.changes[0].path).toBe('a.200.user.email')
  })

  it('가장 최근 관측을 기준으로 한다', () => {
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [] }])]),
      runs: [run('a', '{"old":1}', 200, '2026-07-01T00:00:00.000Z'), run('a', '{"fresh":1}', 200, '2026-07-28T00:00:00.000Z')]
    })
    expect(p.changes.map((c) => c.path)).toEqual(['a.200.fresh'])
  })
})

describe('CASE-apicontract-031·035 미리보기일 뿐 — 원본은 안 바뀐다', () => {
  it('원본 명세를 건드리지 않는다', () => {
    const original = spec([req('a', [{ status: '200', fields: [] }])])
    previewAbsorb({ spec: original, runs: [run('a', '{"x":1}')] })
    expect(original.requests[0].responses[0].fields).toEqual([])
  })

  it('관측이 없거나 JSON 이 아니면 아무것도 안 더한다', () => {
    expect(previewAbsorb({ spec: spec([req('a')]), runs: [] }).changes).toEqual([])
    expect(previewAbsorb({ spec: spec([req('a')]), runs: [run('a', '<html>')] }).changes).toEqual([])
  })

  it('고른 요청만 흡수한다', () => {
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [] }]), req('b', [{ status: '200', fields: [] }])]),
      runs: [run('a', '{"x":1}'), run('b', '{"y":1}')],
      requestNames: ['a']
    })
    expect(p.changes.map((c) => c.path)).toEqual(['a.200.x'])
  })
})

// CASE-apicontract-033 — 깨지는 변경 판정은 버전 diff 와 같은 함수
describe('CASE-apicontract-033 깨짐 판정은 버전 diff 와 같은 함수를 쓴다', () => {
  it('더하기만 하므로 깨지는 변경이 안 나온다', () => {
    const p = previewAbsorb({
      spec: spec([req('a', [{ status: '200', fields: [f('id', 'string', 'required')] }])]),
      runs: [run('a', '{"id":"x","extra":1}')]
    })
    expect(p.diff.breaking).toEqual([])
    expect(p.diff.changes.map((c) => c.kind)).toContain('field-added')
  })

  it('상태 추가도 안전으로 판정된다', () => {
    const p = previewAbsorb({ spec: spec([req('a')]), runs: [run('a', '{}', 404)] })
    expect(p.diff.breaking).toEqual([])
    expect(p.diff.changes.map((c) => c.kind)).toContain('status-added')
  })

  it('바뀐 게 없으면 diff 도 비어 있다', () => {
    const p = previewAbsorb({ spec: spec([req('a', [{ status: '200', fields: [] }])]), runs: [] })
    expect(p.diff.changes).toEqual([])
  })
})
