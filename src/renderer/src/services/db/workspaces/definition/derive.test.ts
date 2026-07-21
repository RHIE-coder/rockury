import { describe, expect, it } from 'vitest'
import type { Column, Constraint, TableDef } from './types'
import { checkColumnIds, checkColumns, keyBadgesOf } from './derive'

const col = (id: string, name: string): Column => ({
  id,
  name,
  type: 'INT',
  nullable: true,
  defaultValue: null,
  comment: ''
})
const table = (columns: Column[], constraints: Constraint[]): TableDef => ({
  id: 't',
  designId: 'd',
  name: 'tbl',
  comment: '',
  columns,
  constraints
})

describe('keyBadgesOf', () => {
  it('single pk / fk', () => {
    const t = table(
      [col('a', 'a'), col('b', 'b')],
      [
        { id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }] },
        { id: 'k2', kind: 'fk', name: 'fk', columns: [{ columnId: 'b' }], refTable: 'x', refColumns: ['id'] }
      ]
    )
    const m = keyBadgesOf(t)
    expect(m.get('a')?.[0]).toMatchObject({ kind: 'pk' })
    expect(m.get('b')?.[0]).toMatchObject({ kind: 'fk' })
  })

  it('composite pk gets 1-based positions', () => {
    const t = table(
      [col('a', 'a'), col('b', 'b')],
      [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }, { columnId: 'b' }] }]
    )
    const m = keyBadgesOf(t)
    expect(m.get('a')?.[0].pos).toBe(1)
    expect(m.get('b')?.[0].pos).toBe(2)
  })
})

describe('checkColumns — word-boundary match', () => {
  const t = table(
    [col('x', 'x'), col('xm', 'x_max'), col('t', 'total_amount')],
    [
      { id: 'c1', kind: 'check', name: 'chk', columns: [], expression: 'x >= 0 AND total_amount >= 0' }
    ]
  )

  it('matches whole identifiers only (x, total_amount) — not x_max', () => {
    const names = checkColumns(t, t.constraints[0]).map((c) => c.name)
    expect(names).toContain('x')
    expect(names).toContain('total_amount')
    expect(names).not.toContain('x_max')
  })

  it('checkColumnIds aggregates referenced ids', () => {
    const ids = checkColumnIds(t)
    expect(ids.has('x')).toBe(true)
    expect(ids.has('t')).toBe(true)
    expect(ids.has('xm')).toBe(false)
  })

  it('non-check constraint yields no columns', () => {
    expect(checkColumns(t, { id: 'z', kind: 'pk', name: 'pk', columns: [] })).toEqual([])
  })
})
