import { describe, expect, it } from 'vitest'
import { groupStatements } from './planGroups'
import type { MigrationStatement } from './ddlDiff'

const st = (table: string, sql: string, destructive = false): MigrationStatement => ({
  table,
  sql,
  kind: 'alter',
  destructive
})

describe('groupStatements', () => {
  it('같은 테이블의 문을 한 묶음으로 모은다', () => {
    const out = groupStatements([st('a', '1'), st('b', '2'), st('a', '3')])
    expect(out.map((g) => g.table)).toEqual(['a', 'b'])
    expect(out[0].statements.map((s) => s.sql)).toEqual(['1', '3'])
  })

  it('테이블은 처음 나온 순서대로 — 실행 순서가 곧 안전 순서다', () => {
    const out = groupStatements([st('z', '1'), st('a', '2'), st('m', '3')])
    expect(out.map((g) => g.table)).toEqual(['z', 'a', 'm'])
  })

  it('묶음 안에서도 원본 순서를 흩지 않는다', () => {
    const out = groupStatements([st('t', 'DROP FK'), st('t', 'DROP COLUMN'), st('t', 'ADD FK')])
    expect(out[0].statements.map((s) => s.sql)).toEqual(['DROP FK', 'DROP COLUMN', 'ADD FK'])
  })

  it('지워지는 문의 개수를 묶음마다 센다', () => {
    const out = groupStatements([st('a', '1', true), st('a', '2'), st('a', '3', true), st('b', '4')])
    expect(out[0].destructiveCount).toBe(2)
    expect(out[1].destructiveCount).toBe(0)
  })

  it('문이 없으면 빈 배열', () => {
    expect(groupStatements([])).toEqual([])
  })
})
