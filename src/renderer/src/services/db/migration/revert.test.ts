import { describe, expect, it } from 'vitest'
import { generateRevert } from './revert'
import { columnId, tableId } from '../ids'
import type { TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'

const table = (name: string, cols: string[]): TableDef => ({
  id: tableId(undefined, name),
  designId: 'd1',
  name,
  comment: '',
  columns: cols.map((c) => ({
    id: columnId(undefined, name, c),
    name: c,
    type: 'int',
    nullable: true,
    defaultValue: null,
    comment: ''
  })) as TableDef['columns'],
  constraints: []
})

const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

describe('generateRevert', () => {
  it('테이블을 만든 반영의 되돌리기는 그 테이블을 지운다', () => {
    const base = snap([])
    const target = snap([table('tags', ['id'])])

    const revert = generateRevert(base, target, 'mysql')

    expect(revert.statements).toHaveLength(1)
    expect(revert.statements[0].kind).toBe('drop')
    expect(revert.statements[0].sql).toContain('DROP TABLE')
  })

  it('테이블을 지운 반영의 되돌리기는 다시 만들지만 — 데이터는 안 돌아온다(lossy)', () => {
    const base = snap([table('orders', ['id'])])
    const target = snap([])

    const revert = generateRevert(base, target, 'mysql')

    expect(revert.statements[0].kind).toBe('create')
    expect(revert.lossy).toHaveLength(1)
    expect(revert.lossy[0].table).toBe('orders')
  })

  it('컬럼만 더한 반영의 되돌리기는 손실이 없다 — 지운 것이 없으니 되찾을 것도 없다', () => {
    const base = snap([table('orders', ['id'])])
    const target = snap([table('orders', ['id', 'memo'])])

    const revert = generateRevert(base, target, 'mysql')

    expect(revert.statements.length).toBeGreaterThan(0)
    expect(revert.lossy).toEqual([])
  })

  it('컬럼을 지운 반영의 되돌리기는 컬럼을 되살리지만 값은 빈다(lossy)', () => {
    const base = snap([table('orders', ['id', 'memo'])])
    const target = snap([table('orders', ['id'])])

    const revert = generateRevert(base, target, 'mysql')

    expect(revert.lossy.length).toBeGreaterThan(0)
    expect(revert.lossy[0].table).toBe('orders')
  })

  it('바뀐 것이 없으면 되돌릴 것도 없다', () => {
    const same = snap([table('orders', ['id'])])

    const revert = generateRevert(same, same, 'mysql')

    expect(revert.statements).toEqual([])
    expect(revert.lossy).toEqual([])
  })

  it('되돌리기는 적용의 정확한 반대다 — 적용의 base 가 되돌리기의 도착지', () => {
    const base = snap([table('a', ['id'])])
    const target = snap([table('b', ['id'])])

    const revert = generateRevert(base, target, 'mysql')
    const kinds = revert.statements.map((s) => `${s.kind}:${s.table}`)

    // 적용은 a 를 지우고 b 를 만들었으니, 되돌리기는 b 를 지우고 a 를 만든다.
    expect(kinds).toContain('drop:b')
    expect(kinds).toContain('create:a')
  })
})
