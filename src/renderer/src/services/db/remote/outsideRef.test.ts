import { describe, expect, it } from 'vitest'
import type { Constraint, TableDef } from '../workspaces/definition/types'
import { classifyOutsideRefs, outsideNodeId, outsideRefOf, outsideReason } from './outsideRef'

const fk = (id: string, refTable: string, refSchema?: string): Constraint => ({
  id,
  kind: 'fk',
  name: id,
  columns: [{ columnId: 'c1' }],
  refTable,
  refSchema,
  refColumns: ['id']
})

const tbl = (schema: string, name: string, constraints: Constraint[] = []): TableDef => ({
  id: `t:${schema}.${name}`,
  designId: 'd',
  schema,
  name,
  comment: '',
  columns: [{ id: 'c1', name: 'ref_id', type: 'bigint', nullable: true, defaultValue: null, comment: '' }],
  constraints
})

describe('classifyOutsideRefs', () => {
  it('범위 안에서 이어지는 FK 는 밖으로 안 잡는다', () => {
    const tables = [tbl('public', 'posts', [fk('k1', 'accounts', 'auth')]), tbl('auth', 'accounts')]
    expect(classifyOutsideRefs(tables, ['public', 'auth'])).toEqual([])
  })

  it('안 켠 스키마를 가리키면 "켜면 들어옴"으로 가른다', () => {
    const tables = [tbl('public', 'posts', [fk('k1', 'plans', 'billing')])]
    const [ref] = classifyOutsideRefs(tables, ['public', 'auth', 'billing'])
    expect(ref.target).toEqual({ schema: 'billing', name: 'plans' })
    expect(ref.kind).toBe('addable')
  })

  it('고를 수 있는 목록에 없으면 "켤 수 없음" — 켤 수 있다고 잘못 말하지 않는다', () => {
    const tables = [tbl('public', 'posts', [fk('k1', 'plans', 'billing')])]
    expect(classifyOutsideRefs(tables, ['public'])[0].kind).toBe('unavailable')
  })

  it('스키마 목록을 못 읽었으면(빈 배열) 전부 켤 수 없음으로 떨어뜨린다', () => {
    const tables = [tbl('public', 'posts', [fk('k1', 'plans', 'billing')])]
    expect(classifyOutsideRefs(tables, [])[0].kind).toBe('unavailable')
  })

  it('스키마를 모르는 참조(예전 데이터)는 켤 대상을 특정할 수 없다', () => {
    const tables = [tbl('', 'posts', [fk('k1', 'gone')])]
    expect(classifyOutsideRefs(tables, ['public'])[0].kind).toBe('unavailable')
  })

  it('같은 곳을 가리키는 FK 가 여럿이면 카드는 하나, 출발점만 쌓인다', () => {
    const tables = [
      tbl('public', 'posts', [fk('k1', 'plans', 'billing')]),
      tbl('public', 'invoices', [fk('k2', 'plans', 'billing')])
    ]
    const refs = classifyOutsideRefs(tables, ['billing'])
    expect(refs).toHaveLength(1)
    expect(refs[0].sources.map((s) => s.table.name)).toEqual(['posts', 'invoices'])
  })

  it('대상 이름순으로 정렬한다 — 자동 배치가 실행마다 안 흔들리게', () => {
    const tables = [
      tbl('public', 'a', [fk('k1', 'zeta', 'billing'), fk('k2', 'alpha', 'billing')])
    ]
    expect(classifyOutsideRefs(tables, ['billing']).map((r) => r.target.name)).toEqual(['alpha', 'zeta'])
  })

  it('refSchema 가 없으면 같은 스키마에서 찾는다 — 거기 있으면 밖이 아니다', () => {
    const tables = [tbl('auth', 'sessions', [fk('k1', 'accounts')]), tbl('auth', 'accounts')]
    expect(classifyOutsideRefs(tables, ['auth'])).toEqual([])
  })

  it('MySQL 교차 database 도 같은 판정을 탄다 — database 가 곧 스키마 자리', () => {
    const tables = [tbl('service2', 'orders', [fk('k1', 'customers', 'service1')])]
    const [ref] = classifyOutsideRefs(tables, ['service1', 'service2', 'service3'])
    expect(ref.kind).toBe('addable')
    expect(ref.target).toEqual({ schema: 'service1', name: 'customers' })
  })
})

describe('outsideRefOf', () => {
  it('그 테이블의 그 제약이 밖인지 되짚는다', () => {
    const posts = tbl('public', 'posts', [fk('k1', 'plans', 'billing'), fk('k2', 'accounts', 'auth')])
    const refs = classifyOutsideRefs([posts, tbl('auth', 'accounts')], ['billing'])
    expect(outsideRefOf(refs, posts, 'k1')?.target.name).toBe('plans')
    expect(outsideRefOf(refs, posts, 'k2')).toBeUndefined()
  })
})

describe('outsideNodeId', () => {
  it('실제 테이블 노드 id 와 안 겹친다', () => {
    expect(outsideNodeId({ schema: 'billing', name: 'plans' })).toBe('out:billing.plans')
    expect(outsideNodeId({ schema: 'billing', name: 'plans' })).not.toBe('t:billing.plans')
  })
})

describe('outsideReason', () => {
  it('벤더가 쓰는 말로 이유를 적는다 — 켤 수 있는지 없는지가 갈린다', () => {
    const addable = classifyOutsideRefs([tbl('a', 'x', [fk('k', 'y', 'b')])], ['b'])[0]
    const nope = classifyOutsideRefs([tbl('a', 'x', [fk('k', 'y', 'b')])], [])[0]
    expect(outsideReason(addable, '스키마')).toContain('켜면')
    expect(outsideReason(nope, '데이터베이스')).toContain('데이터베이스')
    expect(outsideReason(nope, '스키마')).not.toContain('켜면')
  })
})
