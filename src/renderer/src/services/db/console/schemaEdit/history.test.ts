import { describe, expect, it } from 'vitest'
import type { MigrationPlan, MigrationStatement } from '../../migration/ddlDiff'
import { schemaEditHistory } from './history'

const st = (sql: string, kind: MigrationStatement['kind'], table: string): MigrationStatement => ({
  sql,
  kind,
  destructive: kind === 'drop',
  table
})

const plan = (statements: MigrationStatement[]): MigrationPlan => ({
  statements,
  destructiveCount: statements.filter((s) => s.destructive).length,
  unsupported: []
})

describe('schemaEditHistory', () => {
  it('plan 의 각 DDL 을 한 행으로, 같은 runId 로 묶고 seq 를 1부터 매긴다', () => {
    const p = plan([
      st('CREATE TABLE a (id int)', 'create', 'a'),
      st('ALTER TABLE b ADD c int', 'alter', 'b'),
      st('DROP TABLE c', 'drop', 'c')
    ])
    const rows = schemaEditHistory(p, 'conn-1', 'run-xyz')

    expect(rows).toHaveLength(3)
    // 같은 적용 → 같은 runId, seq 오름차순(그룹핑·정렬 규약).
    expect(rows.map((r) => r.runId)).toEqual(['run-xyz', 'run-xyz', 'run-xyz'])
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
    // kind 는 DDL 종류 그대로, source 는 definition, 커밋 후이므로 status 는 success.
    expect(rows.map((r) => r.kind)).toEqual(['create', 'alter', 'drop'])
    expect(rows.every((r) => r.source === 'definition')).toBe(true)
    expect(rows.every((r) => r.status === 'success')).toBe(true)
    expect(rows.every((r) => r.connectionId === 'conn-1')).toBe(true)
    expect(rows[1].sql).toBe('ALTER TABLE b ADD c int')
  })

  it('빈 plan 은 빈 배열', () => {
    expect(schemaEditHistory(plan([]), 'conn-1', 'run-1')).toEqual([])
  })

  it('문 1개도 그룹 규약대로 seq=1 단일 항목을 낸다', () => {
    const rows = schemaEditHistory(plan([st('ALTER TABLE a ADD b int', 'alter', 'a')]), 'c', 'r')
    expect(rows).toHaveLength(1)
    expect(rows[0].seq).toBe(1)
    expect(rows[0].runId).toBe('r')
  })
})
