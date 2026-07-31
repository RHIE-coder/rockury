import { describe, it, expect } from 'vitest'
import type { Column, Constraint, TableDef } from '../../workspaces/definition/types'
import { buildErd } from './graph'
import { isolatedTableIds, matchTables } from './filter'

const col = (t: string, n: string): Column => ({
  id: `c:${t}.${n}`,
  name: n,
  type: 'int',
  nullable: false,
  defaultValue: null,
  comment: ''
})
const tbl = (name: string, cols: string[], constraints: Constraint[] = []): TableDef => ({
  id: `t:${name}`,
  designId: 'd',
  name,
  comment: '',
  columns: cols.map((c) => col(name, c)),
  constraints
})
const fk = (t: string, c: string, refTable: string): Constraint => ({
  id: `k:${t}.fk`,
  kind: 'fk',
  name: `${t}_fk`,
  columns: [{ columnId: `c:${t}.${c}` }],
  refTable,
  refColumns: ['id']
})

describe('matchTables', () => {
  const tables = [tbl('users', ['id', 'email']), tbl('orders', ['id', 'user_id']), tbl('products', ['id', 'sku'])]

  it('빈 검색어면 빈 집합', () => {
    expect(matchTables(tables, '').size).toBe(0)
    expect(matchTables(tables, '   ').size).toBe(0)
  })

  it('테이블명 부분일치(대소문자 무시)', () => {
    expect([...matchTables(tables, 'ORDER')]).toEqual(['t:orders'])
  })

  it('컬럼명으로도 매칭', () => {
    // email 은 users 에만, user_id 는 orders 에만 → 'user' 는 둘 다(users 이름 + orders.user_id)
    expect(matchTables(tables, 'user')).toEqual(new Set(['t:users', 't:orders']))
    expect([...matchTables(tables, 'sku')]).toEqual(['t:products'])
  })

  it('매칭 없으면 빈 집합', () => {
    expect(matchTables(tables, 'zzzzz').size).toBe(0)
  })
})

describe('isolatedTableIds', () => {
  it('관계 없는 테이블만 고립으로', () => {
    const users = tbl('users', ['id'])
    const orders = tbl('orders', ['id', 'user_id'], [fk('orders', 'user_id', 'users')])
    const loner = tbl('audit', ['id'])
    const erd = buildErd([users, orders, loner])
    // users↔orders 는 엣지로 연결, audit 은 고립
    expect(isolatedTableIds(erd)).toEqual(new Set(['t:audit']))
  })

  it('엣지가 전혀 없으면 전부 고립', () => {
    const erd = buildErd([tbl('a', ['id']), tbl('b', ['id'])])
    expect(isolatedTableIds(erd)).toEqual(new Set(['t:a', 't:b']))
  })
})
