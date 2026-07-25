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
    expect(g.tables.map((t) => t.name)).toEqual(['users', 'orders'])
    expect(g.views.map((t) => t.name)).toEqual(['v_user_summary', 'v_active_products'])
  })

  it('전체 개수와 검색 후 개수를 함께 준다', () => {
    const g = groupTablesForList(mixed, 'v_')
    expect(g.total).toBe(4)
    expect(g.shown).toBe(2)
    expect(g.tables).toEqual([])
    expect(g.views).toHaveLength(2)
  })

  it('검색 결과가 없으면 두 묶음 모두 비지만 total 은 남는다', () => {
    const g = groupTablesForList(mixed, 'zzz')
    expect(g.shown).toBe(0)
    expect(g.total).toBe(4)
  })

  it('뷰 표식이 없는 목록(설계부 기존 데이터)은 전부 테이블로 본다', () => {
    const g = groupTablesForList(tables)
    expect(g.views).toEqual([])
    expect(g.tables).toHaveLength(3)
  })
})
