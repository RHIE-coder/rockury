import { describe, expect, it } from 'vitest'
import type { Column, Constraint, TableDef } from './types'
import { checkColumnIds, checkColumns, enforcePkNotNull, keyBadgesOf, pkColumnIds } from './derive'

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

describe('enforcePkNotNull — PK 는 NULL 을 담을 수 없다', () => {
  it('PK 컬럼의 nullable 을 끈다 (2026-08-12: "PK인데 null이 가능해?")', () => {
    const t = table(
      [col('a', 'id'), col('b', 'name')],
      [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }] }]
    )
    const out = enforcePkNotNull(t)
    expect(out.columns[0].nullable).toBe(false)
    // PK 밖의 컬럼은 그대로 — NULL 여부는 사람이 정하는 값이다.
    expect(out.columns[1].nullable).toBe(true)
  })

  it('복합 PK 는 걸린 컬럼 전부', () => {
    const t = table(
      [col('a', 'a'), col('b', 'b'), col('c', 'c')],
      [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }, { columnId: 'b' }] }]
    )
    const out = enforcePkNotNull(t)
    expect(out.columns.map((c) => c.nullable)).toEqual([false, false, true])
  })

  it('UK·인덱스는 NULL 을 허용한다 — PK 만 막는다', () => {
    const t = table(
      [col('a', 'a')],
      [{ id: 'k1', kind: 'uk', name: 'uq', columns: [{ columnId: 'a' }] }]
    )
    expect(enforcePkNotNull(t).columns[0].nullable).toBe(true)
  })

  it('바꿀 것이 없으면 같은 객체 — 안 그러면 편집 없이 저장이 돈다', () => {
    const noPk = table([col('a', 'a')], [])
    expect(enforcePkNotNull(noPk)).toBe(noPk)

    const already = table(
      [{ ...col('a', 'id'), nullable: false }],
      [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }] }]
    )
    expect(enforcePkNotNull(already)).toBe(already)
  })

  it('사라진 컬럼을 가리키는 PK 도 터지지 않는다', () => {
    const t = table(
      [col('a', 'a')],
      [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'gone' }] }]
    )
    expect(enforcePkNotNull(t)).toBe(t)
  })
})

describe('pkColumnIds', () => {
  it('PK 제약의 컬럼만 모은다', () => {
    const t = table(
      [col('a', 'a'), col('b', 'b')],
      [
        { id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'a' }] },
        { id: 'k2', kind: 'idx', name: 'idx', columns: [{ columnId: 'b' }] }
      ]
    )
    expect([...pkColumnIds(t)]).toEqual(['a'])
  })
})
