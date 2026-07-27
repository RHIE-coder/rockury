import { describe, expect, it } from 'vitest'
import type { Column, Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from './store'
import { diffSnapshots, isEmptyDiff } from './diff'

const col = (id: string, name: string, type: string, extra: Partial<Column> = {}): Column => ({
  id,
  name,
  type,
  nullable: false,
  defaultValue: null,
  comment: '',
  ...extra
})
const tbl = (id: string, name: string, columns: Column[], constraints: Constraint[] = [], comment = ''): TableDef => ({
  id,
  designId: 'd',
  name,
  comment,
  columns,
  constraints
})
const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

const base = snap([
  tbl(
    't1',
    'orders',
    [col('c1', 'id', 'BIGINT'), col('c2', 'currency', 'CHAR(3)')],
    [{ id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'c1' }] }],
    '주문'
  )
])

describe('diffSnapshots', () => {
  it('identical → empty', () => {
    const d = diffSnapshots(base, base)
    expect(isEmptyDiff(d)).toBe(true)
    expect(d.summary.tablesModified).toBe(0)
  })

  it('added table', () => {
    const target = snap([...base.tables, tbl('t2', 'shipments', [col('s1', 'id', 'BIGINT')])])
    const d = diffSnapshots(base, target)
    expect(d.summary.tablesAdded).toBe(1)
    expect(d.tables.find((t) => t.name === 'shipments')?.status).toBe('added')
  })

  it('removed table', () => {
    const target = snap([])
    const d = diffSnapshots(base, target)
    expect(d.summary.tablesRemoved).toBe(1)
    expect(d.tables[0].status).toBe('removed')
  })

  it('modified: column added + type change + comment change', () => {
    const target = snap([
      tbl(
        't1',
        'orders',
        [col('c1', 'id', 'BIGINT'), col('c2', 'currency', 'VARCHAR(8)'), col('c3', 'memo', 'TEXT', { nullable: true })],
        base.tables[0].constraints,
        '주문 원장'
      )
    ])
    const d = diffSnapshots(base, target)
    expect(d.summary.tablesModified).toBe(1)
    expect(d.summary.columnsAdded).toBe(1)
    expect(d.summary.columnsModified).toBe(1)
    const t = d.tables[0]
    expect(t.tableChanges.find((c) => c.field === '설명')).toMatchObject({ before: '주문', after: '주문 원장' })
    const currency = t.columns.find((c) => c.name === 'currency')
    expect(currency?.status).toBe('modified')
    expect(currency?.changes.find((c) => c.field === '타입')).toMatchObject({ before: 'CHAR(3)', after: 'VARCHAR(8)' })
    expect(t.columns.find((c) => c.name === 'memo')?.status).toBe('added')
  })

  it('constraint change (onDelete) counts as constraintsModified', () => {
    const withFk = (onDelete: 'RESTRICT' | 'CASCADE'): TableDef =>
      tbl('t1', 'orders', base.tables[0].columns, [
        { id: 'k1', kind: 'pk', name: 'pk', columns: [{ columnId: 'c1' }] },
        { id: 'k2', kind: 'fk', name: 'fk', columns: [{ columnId: 'c2' }], refTable: 'x', refColumns: ['id'], onDelete }
      ])
    const d = diffSnapshots(snap([withFk('RESTRICT')]), snap([withFk('CASCADE')]))
    expect(d.summary.constraintsModified).toBe(1)
  })
})

describe('diffSnapshots — 뷰', () => {
  const asTable = snap([tbl('t9', 'v_summary', [col('c9', 'total', 'BIGINT')])])
  const asView = snap([
    { ...tbl('t9', 'v_summary', [col('c9', 'total', 'BIGINT')]), isView: true, viewSql: 'SELECT 1' }
  ])

  it('테이블 ↔ 뷰 전환을 놓치지 않는다', () => {
    const d = diffSnapshots(asTable, asView)
    expect(d.tables[0].tableChanges).toContainEqual({ field: '종류', before: '테이블', after: '뷰' })
    expect(d.summary.tablesModified).toBe(1)
  })

  it('뷰 본문 변경도 잡는다', () => {
    const changed = snap([
      { ...tbl('t9', 'v_summary', [col('c9', 'total', 'BIGINT')]), isView: true, viewSql: 'SELECT 2' }
    ])
    const d = diffSnapshots(asView, changed)
    expect(d.tables[0].tableChanges).toContainEqual({
      field: '뷰 본문',
      before: 'SELECT 1',
      after: 'SELECT 2'
    })
  })

  it('아무것도 안 바뀌면 조용하다', () => {
    expect(isEmptyDiff(diffSnapshots(asView, asView))).toBe(true)
  })
})
