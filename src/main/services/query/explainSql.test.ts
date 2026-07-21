import { describe, expect, it } from 'vitest'
import {
  buildExplainAnalyzeSql,
  buildExplainSql,
  needsRollback,
  parseExplainSummary,
  queryType
} from './explainSql'

describe('queryType', () => {
  it('SELECT/DML/DDL 분류 (선행 주석 무시)', () => {
    expect(queryType('SELECT 1')).toBe('SELECT')
    expect(queryType('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('SELECT')
    expect(queryType('UPDATE t SET a=1')).toBe('DML')
    expect(queryType('-- c\nDROP TABLE t')).toBe('DDL')
  })
})

describe('buildExplainSql / AnalyzeSql', () => {
  it('방언별 EXPLAIN', () => {
    expect(buildExplainSql('postgresql', 'SELECT 1')).toBe('EXPLAIN (FORMAT JSON) SELECT 1')
    expect(buildExplainSql('mysql', 'SELECT 1')).toBe('EXPLAIN FORMAT=JSON SELECT 1')
    expect(buildExplainSql('sqlite', 'SELECT 1')).toBe('EXPLAIN QUERY PLAN SELECT 1')
  })
  it('ANALYZE 변형 + DDL/sqlite 처리', () => {
    expect(buildExplainAnalyzeSql('postgresql', 'SELECT 1', 'SELECT')).toContain('ANALYZE, BUFFERS')
    expect(buildExplainAnalyzeSql('mariadb', 'SELECT 1', 'SELECT')).toBe('ANALYZE FORMAT=JSON SELECT 1')
    expect(buildExplainAnalyzeSql('mysql', 'SELECT 1', 'SELECT')).toBe('EXPLAIN ANALYZE SELECT 1')
    expect(buildExplainAnalyzeSql('postgresql', 'DROP TABLE t', 'DDL')).toBe('EXPLAIN (FORMAT JSON) DROP TABLE t')
    expect(buildExplainAnalyzeSql('sqlite', 'UPDATE t SET a=1', 'DML')).toBe('EXPLAIN QUERY PLAN UPDATE t SET a=1')
  })
})

describe('needsRollback', () => {
  it('DML & non-sqlite 만 롤백 필요', () => {
    expect(needsRollback('postgresql', 'DML')).toBe(true)
    expect(needsRollback('mysql', 'DML')).toBe(true)
    expect(needsRollback('sqlite', 'DML')).toBe(false)
    expect(needsRollback('postgresql', 'SELECT')).toBe(false)
  })
})

describe('parseExplainSummary', () => {
  it('sqlite detail 를 이어붙임', () => {
    expect(parseExplainSummary([{ detail: 'SCAN users' }, { detail: 'USE INDEX x' }], 'sqlite')).toBe(
      'SCAN users → USE INDEX x'
    )
  })
  it('postgresql plan 노드 요약', () => {
    const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Actual Rows': 10 } }] }]
    expect(parseExplainSummary(rows, 'postgresql')).toBe('Seq Scan · on users · 10 rows')
  })
  it('mysql query_block 요약', () => {
    const rows = [{ EXPLAIN: JSON.stringify({ query_block: { table: { access_type: 'ALL', table_name: 'users', rows_examined_per_scan: 10 } } }) }]
    expect(parseExplainSummary(rows, 'mysql')).toBe('ALL · on users · 10 rows examined')
  })
  it('빈 rows → 빈 문자열', () => {
    expect(parseExplainSummary([], 'postgresql')).toBe('')
  })
})
