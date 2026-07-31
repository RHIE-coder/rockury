import { describe, expect, it } from 'vitest'
import { filterTables, groupTablesForList } from './tableList'
import type { TableDef } from './workspaces/definition/types'

const col = (name: string) => ({
  id: `c:${name}`,
  name,
  type: 'INT',
  nullable: true,
  defaultValue: null,
  comment: ''
})

const table = (name: string, cols: string[] = [], isView = false): TableDef => ({
  id: `t:${name}`,
  designId: 'conn1',
  name,
  comment: '',
  columns: cols.map(col),
  constraints: [],
  isView
})

const tables: TableDef[] = [
  table('users', ['id', 'email']),
  table('orders', ['id', 'user_id', 'total']),
  table('products', ['id', 'sku'])
]

describe('filterTables', () => {
  it('빈 질의는 전체를 원래 순서로', () => {
    expect(filterTables(tables, '   ')).toEqual(tables)
  })

  it('테이블명으로 매칭', () => {
    expect(filterTables(tables, 'ord').map((t) => t.name)).toEqual(['orders'])
  })

  it('컬럼명으로도 매칭(대소문자 무시)', () => {
    expect(filterTables(tables, 'EMAIL').map((t) => t.name)).toEqual(['users'])
  })

  it('테이블·컬럼 양쪽에 걸리면 중복 없이 각 테이블 한 번', () => {
    expect(filterTables(tables, 'user').map((t) => t.name)).toEqual(['users', 'orders'])
  })

  it('매칭 없으면 빈 배열', () => {
    expect(filterTables(tables, 'zzz')).toEqual([])
  })
})

describe('groupTablesForList', () => {
  const mixed: TableDef[] = [
    table('users', ['id']),
    table('v_user_summary', ['id', 'total'], true),
    table('orders', ['id']),
    table('v_active_products', ['id'], true)
  ]

  it('테이블과 뷰를 갈라 담고 각 묶음의 순서를 유지한다', () => {
    const g = groupTablesForList(mixed)
    expect(g.groups).toHaveLength(1)
    expect(g.multiSchema).toBe(false)
    expect(g.groups[0].tables.map((t) => t.name)).toEqual(['users', 'orders'])
    expect(g.groups[0].views.map((t) => t.name)).toEqual(['v_user_summary', 'v_active_products'])
  })

  it('전체 개수와 검색 후 개수를 함께 준다', () => {
    const g = groupTablesForList(mixed, 'v_')
    expect(g.total).toBe(4)
    expect(g.shown).toBe(2)
    expect(g.groups[0].tables).toEqual([])
    expect(g.groups[0].views).toHaveLength(2)
  })

  it('검색 결과가 없으면 두 묶음 모두 비지만 total 은 남는다', () => {
    const g = groupTablesForList(mixed, 'zzz')
    expect(g.shown).toBe(0)
    expect(g.total).toBe(4)
  })

  it('뷰 표식이 없는 목록(설계부 기존 데이터)은 전부 테이블로 본다', () => {
    const g = groupTablesForList(tables)
    expect(g.groups[0].views).toEqual([])
    expect(g.groups[0].tables).toHaveLength(3)
  })
})

// 범위(scope)를 켜면 여러 스키마가 한 목록에 섞인다. 표시가 없으면 `card`(entity)와
// `cards`(public)가 아무 구분 없이 나란히 선다(2026-07-30 사용자 실측: "내가 어떻게 구분하냐").
describe('groupTablesForList — 여러 스키마', () => {
  const scoped = (schema: string, name: string, isView = false): TableDef => ({
    ...table(name, ['id'], isView),
    id: `${schema}.${name}`,
    schema
  })

  const multi = [
    scoped('public', 'cards'),
    scoped('entity', 'card'),
    scoped('public', 'v_stats', true),
    scoped('entity', 'price')
  ]

  it('스키마 이름순으로 묶고, 묶음 안에서 테이블/뷰를 가른다', () => {
    const g = groupTablesForList(multi)
    expect(g.multiSchema).toBe(true)
    expect(g.groups.map((x) => x.schema)).toEqual(['entity', 'public'])
    expect(g.groups[0].tables.map((t) => t.name)).toEqual(['card', 'price'])
    expect(g.groups[1].tables.map((t) => t.name)).toEqual(['cards'])
    expect(g.groups[1].views.map((t) => t.name)).toEqual(['v_stats'])
  })

  it('스키마 이름으로도 검색된다 — "auth 것만 보기"가 검색 한 번으로 된다', () => {
    const g = groupTablesForList(multi, 'entity')
    expect(g.shown).toBe(2)
    expect(g.groups.map((x) => x.schema)).toEqual(['entity'])
  })

  it('검색으로 한 스키마만 남아도 머리는 계속 그린다 — 지금 보는 것이 어디인지 알아야 한다', () => {
    // multiSchema 판정은 검색 결과가 아니라 전체 목록 기준.
    expect(groupTablesForList(multi, 'entity').multiSchema).toBe(true)
  })

  it('스키마가 하나뿐이면 머리를 안 그린다(시끄럽다)', () => {
    expect(groupTablesForList([scoped('public', 'a'), scoped('public', 'b')]).multiSchema).toBe(false)
  })
})
