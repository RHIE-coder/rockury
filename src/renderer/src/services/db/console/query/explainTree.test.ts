import { describe, expect, it } from 'vitest'
import { parseExplainTree } from './explainTree'

describe('parseExplainTree', () => {
  it('postgresql: QUERY PLAN 배열을 그대로', () => {
    const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan' } }] }]
    expect(parseExplainTree(rows, 'postgresql')).toEqual([{ Plan: { 'Node Type': 'Seq Scan' } }])
  })
  it('postgresql: QUERY PLAN 문자열을 JSON 파싱', () => {
    const rows = [{ 'QUERY PLAN': '[{"Plan":{"Node Type":"Index Scan"}}]' }]
    expect(parseExplainTree(rows, 'postgresql')).toEqual([{ Plan: { 'Node Type': 'Index Scan' } }])
  })
  it('mysql: EXPLAIN 문자열을 JSON 파싱', () => {
    const rows = [{ EXPLAIN: '{"query_block":{"select_id":1}}' }]
    expect(parseExplainTree(rows, 'mysql')).toEqual({ query_block: { select_id: 1 } })
  })
  it('sqlite: 평면 행을 그대로', () => {
    const rows = [{ id: 0, parent: 0, detail: 'SCAN t' }]
    expect(parseExplainTree(rows, 'sqlite')).toEqual(rows)
  })
  it('빈 입력은 null', () => {
    expect(parseExplainTree([], 'postgresql')).toBeNull()
  })
  it('깨진 JSON 은 원본 planRows 로 폴백', () => {
    const rows = [{ EXPLAIN: '{not json' }]
    expect(parseExplainTree(rows, 'mysql')).toEqual(rows)
  })
})
