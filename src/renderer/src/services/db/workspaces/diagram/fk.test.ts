import { describe, it, expect } from 'vitest'
import type { Column, Constraint, TableDef } from '../definition/types'
import { buildFkPatch, defaultRefColumns } from './fk'

const col = (t: string, n: string): Column => ({
  id: `${t}.${n}`,
  name: n,
  type: 'int',
  nullable: false,
  defaultValue: null,
  comment: ''
})
const tbl = (name: string, cols: string[], constraints: Constraint[] = []): TableDef => ({
  id: `tbl-${name}`,
  designId: 'd',
  name,
  comment: '',
  columns: cols.map((c) => col(name, c)),
  constraints
})
const pk = (t: string, cols: string[]): Constraint => ({
  id: `con-${t}-pk`,
  kind: 'pk',
  name: `${t}_pk`,
  columns: cols.map((c) => ({ columnId: `${t}.${c}` }))
})

describe('defaultRefColumns', () => {
  it('PK 컬럼명을 순서대로 반환', () => {
    const t = tbl('parent', ['a', 'b'], [pk('parent', ['a', 'b'])])
    expect(defaultRefColumns(t)).toEqual(['a', 'b'])
  })
  it('PK 없으면 첫 컬럼', () => {
    expect(defaultRefColumns(tbl('x', ['first', 'second']))).toEqual(['first'])
  })
  it('컬럼도 없으면 빈 배열', () => {
    expect(defaultRefColumns(tbl('empty', []))).toEqual([])
  })
})

describe('buildFkPatch', () => {
  const users = tbl('users', ['id'], [pk('users', ['id'])])
  const orders = tbl('orders', ['id', 'user_id'], [pk('orders', ['id'])])

  it('소스 컬럼 → 대상 PK 로 FK 패치 생성', () => {
    const patch = buildFkPatch(orders, 'orders.user_id', users)
    expect(patch).toEqual({
      columns: [{ columnId: 'orders.user_id' }],
      refTable: 'users',
      refColumns: ['id']
    })
  })

  it('소스 컬럼이 소스 테이블에 없으면 null', () => {
    expect(buildFkPatch(orders, 'orders.ghost', users)).toBeNull()
  })
})
