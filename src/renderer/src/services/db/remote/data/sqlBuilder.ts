import type { TableDef } from '../../workspaces/definition/types'
import type { TableRef } from '../../schemaRef'
import type { DialectId } from '../../dialects'

/**
 * 데이터 편집 SQL 빌더(§ops-plan Phase 2b) — **파라미터 바인드**로 문을 만든다(문자열 조립 금지).
 * rky sqlBuilder(escapeValue 문자열 삽입)의 결함을 고쳐, 값은 전부 바인드 파라미터로 분리한다.
 * 방언별 식별자 인용(mysql=백틱, pg/sqlite=쌍따옴표)과 플레이스홀더(pg=$n, 그 외=?)를 처리.
 * 순수 함수 → 테스트 의무 대상.
 */
export type SqlDialect = DialectId

export interface Statement {
  sql: string
  params: unknown[]
}

export function quoteIdent(dialect: SqlDialect, name: string): string {
  if (dialect === 'postgresql' || dialect === 'sqlite') return `"${name.replace(/"/g, '""')}"`
  return `\`${name.replace(/`/g, '``')}\``
}

/**
 * SQL 에 쓸 테이블 이름 — 스키마를 알면 **반드시 한정한다**(`스키마.테이블`).
 *
 * 왜 "알면 반드시"인가: 이름만 넣으면 연결이 처음 붙은 기본 스키마에서 찾는다. 범위(scope)로
 * 다른 스키마를 보고 있으면 없다고 하거나(2026-08-01 피드백 — `Table 'testdb.customers'
 * doesn't exist`), **더 나쁘게는 같은 이름의 다른 테이블을 조용히 읽는다.**
 * 스키마가 하나뿐일 때 붙는 한정은 뜻이 안 바뀌므로, "여럿일 때만" 같은 조건을 두지 않는다.
 */
export function quoteTable(dialect: SqlDialect, t: TableRef): string {
  const q = (n: string): string => quoteIdent(dialect, n)
  return t.schema ? `${q(t.schema)}.${q(t.name)}` : q(t.name)
}

const ph = (dialect: SqlDialect, i: number): string => (dialect === 'postgresql' ? `$${i}` : '?')
const safeInt = (n: number): number => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))

/** 필터 연산자 — 값 없는 IS NULL / IS NOT NULL 포함. */
export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL'
export const FILTER_OPS: FilterOp[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IS NULL', 'IS NOT NULL']
export const NO_VALUE_OPS: FilterOp[] = ['IS NULL', 'IS NOT NULL']

export interface Filter {
  column: string
  op: FilterOp
  value: string
}

export interface SelectOptions {
  limit: number
  offset: number
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }
  filters?: Filter[]
}

/** SELECT * … [WHERE …] [ORDER BY …] LIMIT/OFFSET. WHERE 값은 파라미터 바인드(문자열 조립 금지). */
export function buildSelect(dialect: SqlDialect, table: TableRef, opts: SelectOptions): Statement {
  const q = (n: string): string => quoteIdent(dialect, n)
  const params: unknown[] = []
  let i = 1
  let sql = `SELECT * FROM ${quoteTable(dialect, table)}`

  const clauses = (opts.filters ?? [])
    .filter((f) => f.column && (NO_VALUE_OPS.includes(f.op) || f.value !== ''))
    .map((f) => {
      if (f.op === 'IS NULL') return `${q(f.column)} IS NULL`
      if (f.op === 'IS NOT NULL') return `${q(f.column)} IS NOT NULL`
      params.push(f.value)
      return `${q(f.column)} ${f.op} ${ph(dialect, i++)}`
    })
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`

  if (opts.orderBy) {
    sql += ` ORDER BY ${q(opts.orderBy.column)} ${opts.orderBy.direction === 'DESC' ? 'DESC' : 'ASC'}`
  }
  sql += ` LIMIT ${safeInt(opts.limit)} OFFSET ${safeInt(opts.offset)}`
  return { sql, params }
}

export function buildInsert(
  dialect: SqlDialect,
  table: TableRef,
  values: Record<string, unknown>
): Statement {
  const cols = Object.keys(values)
  if (cols.length === 0) throw new Error('INSERT: 컬럼이 없습니다')
  const q = (n: string): string => quoteIdent(dialect, n)
  const params: unknown[] = []
  let i = 1
  const valSql = cols
    .map((c) => {
      params.push(values[c])
      return ph(dialect, i++)
    })
    .join(', ')
  return {
    sql: `INSERT INTO ${quoteTable(dialect, table)} (${cols.map(q).join(', ')}) VALUES (${valSql})`,
    params
  }
}

export function buildUpdate(
  dialect: SqlDialect,
  table: TableRef,
  pkColumns: string[],
  pkValues: Record<string, unknown>,
  changes: Record<string, unknown>
): Statement {
  const changed = Object.keys(changes)
  if (changed.length === 0) throw new Error('UPDATE: 변경할 컬럼이 없습니다')
  if (pkColumns.length === 0) throw new Error('UPDATE: PK 가 없어 안전하게 수정할 수 없습니다')
  const q = (n: string): string => quoteIdent(dialect, n)
  const params: unknown[] = []
  let i = 1
  const setSql = changed
    .map((c) => {
      params.push(changes[c])
      return `${q(c)} = ${ph(dialect, i++)}`
    })
    .join(', ')
  const whereSql = pkColumns
    .map((pk) => {
      params.push(pkValues[pk])
      return `${q(pk)} = ${ph(dialect, i++)}`
    })
    .join(' AND ')
  return { sql: `UPDATE ${quoteTable(dialect, table)} SET ${setSql} WHERE ${whereSql}`, params }
}

export function buildDelete(
  dialect: SqlDialect,
  table: TableRef,
  pkColumns: string[],
  pkValues: Record<string, unknown>
): Statement {
  if (pkColumns.length === 0) throw new Error('DELETE: PK 가 없어 안전하게 삭제할 수 없습니다')
  const q = (n: string): string => quoteIdent(dialect, n)
  const params: unknown[] = []
  let i = 1
  const whereSql = pkColumns
    .map((pk) => {
      params.push(pkValues[pk])
      return `${q(pk)} = ${ph(dialect, i++)}`
    })
    .join(' AND ')
  return { sql: `DELETE FROM ${quoteTable(dialect, table)} WHERE ${whereSql}`, params }
}

/** 테이블의 PK 컬럼명(순서 유지). PK 제약의 컬럼 참조를 컬럼명으로 해석. */
export function pkColumns(table: TableDef): string[] {
  const pk = table.constraints.find((c) => c.kind === 'pk')
  if (!pk) return []
  return pk.columns
    .map((ref) => table.columns.find((c) => c.id === ref.columnId)?.name)
    .filter((n): n is string => !!n)
}

/** PK 가 있어야 편집 가능(§ops-plan — PK 없으면 읽기전용). */
export function canEdit(table: TableDef): boolean {
  return pkColumns(table).length > 0
}
