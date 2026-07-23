import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { filterTables, resolveActiveTable } from './select'

const col = (name: string) => ({
  id: `c:${name}`,
  name,
  type: 'INT',
  nullable: true,
  defaultValue: null,
  comment: ''
})

const table = (name: string, cols: string[] = []): TableDef => ({
  id: `t:${name}`,
  designId: 'conn1',
  name,
  comment: '',
  columns: cols.map(col),
  constraints: []
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
    // 'EMAIL' 은 users 컬럼에만 존재 → users 매칭
    expect(filterTables(tables, 'EMAIL').map((t) => t.name)).toEqual(['users'])
  })

  it('테이블·컬럼 양쪽에 걸리면 중복 없이 각 테이블 한 번', () => {
    // 'user' → users(이름) + orders(user_id 컬럼)
    expect(filterTables(tables, 'user').map((t) => t.name)).toEqual(['users', 'orders'])
  })

  it('매칭 없으면 빈 배열', () => {
    expect(filterTables(tables, 'zzz')).toEqual([])
  })
})

describe('resolveActiveTable', () => {
  it('id 로 찾는다', () => {
    expect(resolveActiveTable(tables, 't:orders')?.name).toBe('orders')
  })

  it('id 가 목록에 없으면 첫 테이블로 폴백', () => {
    expect(resolveActiveTable(tables, 't:gone')?.name).toBe('users')
  })

  it('activeId 가 null 이면 첫 테이블', () => {
    expect(resolveActiveTable(tables, null)?.name).toBe('users')
  })

  it('빈 목록이면 undefined', () => {
    expect(resolveActiveTable([], 't:users')).toBeUndefined()
  })
})
