import type { DialectId } from '../../dialects'

/**
 * EXPLAIN planRows → 트리 렌더용 정규화(§ops 향상 — Query Tier A).
 * 방언별 구조가 달라(pg: QUERY PLAN JSON, mysql: EXPLAIN JSON 문자열, sqlite: 평면 detail 행)
 * 공통적으로 재귀 트리로 그릴 수 있는 JS 값으로 접는다. 순수 함수 → 테스트 의무 대상.
 */
export function parseExplainTree(planRows: Record<string, unknown>[], dialect: DialectId): unknown {
  if (!planRows || planRows.length === 0) return null
  try {
    if (dialect === 'postgresql') {
      const raw = planRows[0]['QUERY PLAN']
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string') return JSON.parse(raw)
      return planRows
    }
    if (dialect === 'mysql' || dialect === 'mariadb') {
      const raw = planRows[0].EXPLAIN
      if (typeof raw === 'string') return JSON.parse(raw)
      return planRows
    }
    // sqlite — EXPLAIN QUERY PLAN 평면 행(detail). 그대로 트리로.
    return planRows
  } catch {
    return planRows
  }
}
