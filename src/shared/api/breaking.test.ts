import { describe, expect, it } from 'vitest'
import { diffSpecs, hasBreaking } from './breaking'
import type { FieldDef, ParamDef, RequestDef, ResponseDef, SpecDef } from './types'

/**
 * 깨지는 변경 판정 — `docs/qa/api-studio.md` S5 (CASE-apistudio-040~045).
 *
 * 이 모듈의 전부는 **비대칭**이다:
 *   요청은 *더 요구하면* 깨지고, 응답은 *덜 주면* 깨진다.
 * 방향을 뒤집어 구현하면 CASE-apistudio-043 이 반드시 실패한다.
 */

const req = (
  name: string,
  params: ParamDef[] = [],
  responses: ResponseDef[] = [],
  docs = ''
): RequestDef => ({
  id: name,
  name,
  folder: '',
  shape: 'unary',
  params,
  request: { method: 'GET', path: `/${name}` },
  responses,
  docs
})

const spec = (requests: RequestDef[]): SpecDef => ({
  id: 's1',
  name: 'S',
  description: '',
  kind: 'rest',
  requests
})

const f = (name: string, type: FieldDef['type'], requiredness: FieldDef['requiredness']): FieldDef => ({
  name,
  type,
  requiredness
})

const ok = (fields: FieldDef[]): ResponseDef => ({ status: '200', fields })

const kinds = (before: SpecDef, after: SpecDef): string[] =>
  diffSpecs(before, after).changes.map((c) => `${c.direction}:${c.kind}:${c.severity}`)

// ── CASE-apistudio-040 — 요청 쪽 깨짐 ──────────────────────────────────────

describe('CASE-apistudio-040 요청은 *더 요구하면* 깨진다', () => {
  it('필수 파라미터 추가', () => {
    const before = spec([req('getUser')])
    const after = spec([req('getUser', [{ name: 'id', type: 'string', required: true }])])
    expect(kinds(before, after)).toEqual(['request:param-added-required:breaking'])
    expect(hasBreaking(diffSpecs(before, after))).toBe(true)
  })

  it('선택 → 필수 로 조인다', () => {
    const before = spec([req('u', [{ name: 'id', type: 'string', required: false }])])
    const after = spec([req('u', [{ name: 'id', type: 'string', required: true }])])
    expect(kinds(before, after)).toEqual(['request:param-required-tightened:breaking'])
  })

  it('파라미터 타입 변경', () => {
    const before = spec([req('u', [{ name: 'id', type: 'string', required: true }])])
    const after = spec([req('u', [{ name: 'id', type: 'number', required: true }])])
    expect(kinds(before, after)).toEqual(['request:param-type-changed:breaking'])
  })

  it('enum 허용 값 제거', () => {
    const e = (values: string[]): ParamDef => ({
      name: 'sort',
      type: 'enum',
      required: false,
      enumValues: values
    })
    const before = spec([req('u', [e(['asc', 'desc'])])])
    const after = spec([req('u', [e(['asc'])])])
    expect(kinds(before, after)).toEqual(['request:param-enum-narrowed:breaking'])
  })

  it('요청 자체가 사라지면 깨진다', () => {
    expect(kinds(spec([req('a'), req('b')]), spec([req('a')]))).toEqual([
      'request:request-removed:breaking'
    ])
  })
})

// ── CASE-apistudio-041 — 응답 쪽 깨짐 ──────────────────────────────────────

describe('CASE-apistudio-041 응답은 *덜 주면* 깨진다', () => {
  it('응답 필드 제거', () => {
    const before = spec([req('u', [], [ok([f('id', 'string', 'required')])])])
    const after = spec([req('u', [], [ok([])])])
    expect(kinds(before, after)).toEqual(['response:field-removed:breaking'])
  })

  it('응답 필드 타입 변경', () => {
    const before = spec([req('u', [], [ok([f('n', 'number', 'required')])])])
    const after = spec([req('u', [], [ok([f('n', 'string', 'required')])])])
    expect(kinds(before, after)).toEqual(['response:field-type-changed:breaking'])
  })

  it('응답 필드 필수 → nullable (있다고 믿던 게 없어질 수 있다)', () => {
    const before = spec([req('u', [], [ok([f('id', 'string', 'required')])])])
    const after = spec([req('u', [], [ok([f('id', 'string', 'nullable')])])])
    expect(kinds(before, after)).toEqual(['response:field-loosened:breaking'])
  })

  it('선언된 상태 제거', () => {
    const before = spec([req('u', [], [ok([]), { status: '404', fields: [] }])])
    const after = spec([req('u', [], [ok([])])])
    expect(kinds(before, after)).toEqual(['response:status-removed:breaking'])
  })

  it('중첩 필드도 경로와 함께 잡는다', () => {
    const nested = (r: FieldDef['requiredness']): ResponseDef =>
      ok([{ name: 'user', type: 'object', requiredness: 'required', fields: [f('email', 'string', r)] }])
    const d = diffSpecs(spec([req('u', [], [nested('required')])]), spec([req('u', [], [nested('nullable')])]))
    expect(d.breaking).toHaveLength(1)
    expect(d.breaking[0].path).toBe('u.200.user.email')
  })
})

// ── CASE-apistudio-042 — 안전한 변경 ───────────────────────────────────────

describe('CASE-apistudio-042 안전한 변경은 경고도 아니다', () => {
  it('선택 파라미터 추가 · 필수 → 선택 · enum 확대', () => {
    const before = spec([
      req('u', [
        { name: 'id', type: 'string', required: true },
        { name: 'sort', type: 'enum', required: false, enumValues: ['asc'] }
      ])
    ])
    const after = spec([
      req('u', [
        { name: 'id', type: 'string', required: false },
        { name: 'sort', type: 'enum', required: false, enumValues: ['asc', 'desc'] },
        { name: 'page', type: 'number', required: false }
      ])
    ])
    const d = diffSpecs(before, after)
    expect(d.breaking).toEqual([])
    expect(d.changes.every((c) => c.severity === 'safe')).toBe(true)
  })

  it('응답 필드 추가 · nullable → 필수 · 상태 추가', () => {
    const before = spec([req('u', [], [ok([f('id', 'string', 'nullable')])])])
    const after = spec([
      req('u', [], [ok([f('id', 'string', 'required'), f('name', 'string', 'required')]), { status: '404', fields: [] }])
    ])
    expect(diffSpecs(before, after).breaking).toEqual([])
  })

  it('요청 추가와 설명 변경은 안전하다', () => {
    const d = diffSpecs(spec([req('a', [], [], '옛 설명')]), spec([req('a', [], [], '새 설명'), req('b')]))
    expect(d.breaking).toEqual([])
    expect(d.changes.map((c) => c.kind).sort()).toEqual(['docs-changed', 'request-added'])
  })
})

// ── CASE-apistudio-043 — 비대칭 회귀 ───────────────────────────────────────

describe('CASE-apistudio-043 같은 연산이 방향에 따라 다르게 판정된다', () => {
  it('느슨하게 하기: 요청에서는 안전, 응답에서는 깨짐', () => {
    const reqLoosen = diffSpecs(
      spec([req('u', [{ name: 'id', type: 'string', required: true }])]),
      spec([req('u', [{ name: 'id', type: 'string', required: false }])])
    )
    const resLoosen = diffSpecs(
      spec([req('u', [], [ok([f('id', 'string', 'required')])])]),
      spec([req('u', [], [ok([f('id', 'string', 'nullable')])])])
    )
    expect(reqLoosen.breaking).toEqual([])
    expect(resLoosen.breaking).toHaveLength(1)
  })

  it('조이기: 요청에서는 깨짐, 응답에서는 안전', () => {
    const reqTighten = diffSpecs(
      spec([req('u', [{ name: 'id', type: 'string', required: false }])]),
      spec([req('u', [{ name: 'id', type: 'string', required: true }])])
    )
    const resTighten = diffSpecs(
      spec([req('u', [], [ok([f('id', 'string', 'nullable')])])]),
      spec([req('u', [], [ok([f('id', 'string', 'required')])])])
    )
    expect(reqTighten.breaking).toHaveLength(1)
    expect(resTighten.breaking).toEqual([])
  })

  it('enum 값 추가는 양쪽 다 안전하고, 제거는 요청에서만 깨진다', () => {
    const e = (values: string[]): ParamDef => ({ name: 's', type: 'enum', required: false, enumValues: values })
    expect(diffSpecs(spec([req('u', [e(['a'])])]), spec([req('u', [e(['a', 'b'])])])).breaking).toEqual([])
    expect(diffSpecs(spec([req('u', [e(['a', 'b'])])]), spec([req('u', [e(['a'])])])).breaking).toHaveLength(1)

    const re = (values: string[]): ResponseDef =>
      ok([{ name: 'st', type: 'string', requiredness: 'required', enumValues: values }])
    expect(diffSpecs(spec([req('u', [], [re(['a'])])]), spec([req('u', [], [re(['a', 'b'])])])).breaking).toEqual([])
  })
})

// ── CASE-apistudio-044 — '모름' 제외 ───────────────────────────────────────

describe("CASE-apistudio-044 필수여부 '모름'은 판정에서 빠지고, 뺐다는 사실이 남는다", () => {
  it('모름이 끼면 필수여부 판정을 하지 않는다', () => {
    const before = spec([req('u', [], [ok([f('id', 'string', 'unknown')])])])
    const after = spec([req('u', [], [ok([f('id', 'string', 'nullable')])])])
    const d = diffSpecs(before, after)
    expect(d.breaking).toEqual([])
    expect(d.skippedUnknown).toBe(1)
  })

  it('반대 방향(모름으로 바뀜)도 제외된다', () => {
    const d = diffSpecs(
      spec([req('u', [], [ok([f('id', 'string', 'required')])])]),
      spec([req('u', [], [ok([f('id', 'string', 'unknown')])])])
    )
    expect(d.breaking).toEqual([])
    expect(d.skippedUnknown).toBe(1)
  })

  it('모름이라도 타입 변경은 여전히 깨짐이다 — 제외는 필수여부에만 걸린다', () => {
    const d = diffSpecs(
      spec([req('u', [], [ok([f('id', 'string', 'unknown')])])]),
      spec([req('u', [], [ok([f('id', 'number', 'unknown')])])])
    )
    expect(d.breaking).toHaveLength(1)
    expect(d.breaking[0].kind).toBe('field-type-changed')
  })

  it('모름을 안전으로 세지 않는다 — 제외 개수가 0이면 판정이 잘못된 것', () => {
    const d = diffSpecs(
      spec([req('u', [], [ok([f('a', 'string', 'unknown'), f('b', 'string', 'unknown')])])]),
      spec([req('u', [], [ok([f('a', 'string', 'required'), f('b', 'string', 'nullable')])])])
    )
    expect(d.skippedUnknown).toBe(2)
  })
})

// ── CASE-apistudio-045 — 집계 ──────────────────────────────────────────────

describe('CASE-apistudio-045 diff 집계', () => {
  it('손대지 않은 항목은 결과에 안 나온다', () => {
    const same = spec([req('u', [{ name: 'id', type: 'string', required: true }], [ok([f('x', 'string', 'required')])])])
    expect(diffSpecs(same, same).changes).toEqual([])
    expect(diffSpecs(same, same).skippedUnknown).toBe(0)
  })

  it('여러 변경을 한 번에 모으고 breaking 만 따로 준다', () => {
    const before = spec([req('a', [{ name: 'p', type: 'string', required: false }]), req('gone')])
    const after = spec([
      req('a', [{ name: 'p', type: 'number', required: false }, { name: 'q', type: 'string', required: false }]),
      req('new')
    ])
    const d = diffSpecs(before, after)
    expect(d.changes).toHaveLength(4) // 타입변경 · 선택추가 · 요청제거 · 요청추가
    expect(d.breaking.map((c) => c.kind).sort()).toEqual(['param-type-changed', 'request-removed'])
  })

  it('모든 변경에 사람이 읽을 설명이 붙는다', () => {
    const d = diffSpecs(spec([req('a')]), spec([req('a', [{ name: 'x', type: 'string', required: true }])]))
    expect(d.changes[0].detail.length).toBeGreaterThan(0)
    expect(d.changes[0].path).toBe('a.x')
  })
})
