import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { resolveActiveTable } from './select'

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

// 목록 검색(filterTables)·테이블/뷰 가르기 테스트는 정본이 옮겨간 db/tableList.test.ts 에 있다.

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
