import { quoteIdent, type SqlDialect } from './sqlBuilder'

/**
 * 결과/행 export(§ops 향상 — Data). 순수 → 테스트 의무 대상.
 * CSV / JSON / SQL INSERT. (SQL 은 파일 산출물이라 값 이스케이프 인라인 — 실행 경로 아님.)
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(csvCell).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))
  return [header, ...body].join('\n')
}

export function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2)
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}

export function toSqlInsert(
  dialect: SqlDialect,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  const q = (n: string): string => quoteIdent(dialect, n)
  const cols = columns.map(q).join(', ')
  return rows
    .map((r) => `INSERT INTO ${q(table)} (${cols}) VALUES (${columns.map((c) => sqlLiteral(r[c])).join(', ')});`)
    .join('\n')
}
