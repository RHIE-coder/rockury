/**
 * EXPLAIN SQL 빌드/분류/요약(§ops 향상 — Query). 순수 함수 → 테스트 의무 대상.
 * rky `shared/lib/explainSql` 이식. DML 은 실행 계획을 얻되 실제 반영은 롤백으로 막는다(안전 프리플라이트).
 */
export type ExplainDbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'
export type QueryType = 'SELECT' | 'DML' | 'DDL'

const stripLeading = (sql: string): string =>
  sql.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, '').trim()

export function queryType(sql: string): QueryType {
  const u = stripLeading(sql).toUpperCase()
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT\s+ON)\b/.test(u)) return 'DDL'
  if (/^(INSERT|UPDATE|DELETE)\b/.test(u)) return 'DML'
  return 'SELECT'
}

export function buildExplainSql(dbType: ExplainDbType, sql: string): string {
  switch (dbType) {
    case 'postgresql':
      return `EXPLAIN (FORMAT JSON) ${sql}`
    case 'mysql':
    case 'mariadb':
      return `EXPLAIN FORMAT=JSON ${sql}`
    default:
      return `EXPLAIN QUERY PLAN ${sql}`
  }
}

export function buildExplainAnalyzeSql(dbType: ExplainDbType, sql: string, qt: QueryType): string {
  if (dbType === 'sqlite') return `EXPLAIN QUERY PLAN ${sql}`
  if (qt === 'DDL') return buildExplainSql(dbType, sql)
  switch (dbType) {
    case 'postgresql':
      return `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
    case 'mariadb':
      return `ANALYZE FORMAT=JSON ${sql}`
    default:
      return `EXPLAIN ANALYZE ${sql}`
  }
}

/** DML 은 non-sqlite 에서 실제 실행되므로 BEGIN/ROLLBACK 으로 감싸야 안전. */
export function needsRollback(dbType: ExplainDbType, qt: QueryType): boolean {
  return qt === 'DML' && dbType !== 'sqlite'
}

/** 계획 rows → 한 줄 요약(벤더별). 실패 시 빈 문자열. */
export function parseExplainSummary(rows: Record<string, unknown>[], dbType: ExplainDbType): string {
  if (!rows || rows.length === 0) return ''
  try {
    if (dbType === 'sqlite') {
      return rows
        .map((r) => String(r.detail ?? ''))
        .filter(Boolean)
        .join(' → ')
    }
    if (dbType === 'postgresql') {
      const raw = rows[0]?.['QUERY PLAN']
      const plans = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : null
      const plan = plans?.[0]?.Plan
      if (!plan) return JSON.stringify(rows[0]).slice(0, 120)
      const parts: string[] = [plan['Node Type'] ?? '']
      if (plan['Relation Name']) parts.push(`on ${plan['Relation Name']}`)
      if (typeof plan['Actual Rows'] === 'number') parts.push(`${plan['Actual Rows']} rows`)
      if (typeof plan['Actual Total Time'] === 'number') parts.push(`${plan['Actual Total Time']}ms`)
      return parts.filter(Boolean).join(' · ')
    }
    // mysql / mariadb — 첫 컬럼이 JSON 문자열
    const first = rows[0]
    const jsonStr = Object.values(first)[0]
    if (typeof jsonStr === 'string') {
      try {
        const parsed = JSON.parse(jsonStr)
        const table = parsed?.query_block?.table
        if (table) {
          const parts: string[] = []
          if (table.access_type) parts.push(String(table.access_type))
          if (table.table_name) parts.push(`on ${table.table_name}`)
          if (typeof table.rows_examined_per_scan === 'number')
            parts.push(`${table.rows_examined_per_scan} rows examined`)
          return parts.filter(Boolean).join(' · ')
        }
        return JSON.stringify(parsed).slice(0, 120)
      } catch {
        return String(jsonStr).slice(0, 120)
      }
    }
    return JSON.stringify(first).slice(0, 120)
  } catch {
    return ''
  }
}
