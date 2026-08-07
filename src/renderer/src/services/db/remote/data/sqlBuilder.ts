import type { TableDef } from '../../workspaces/definition/types'
import type { TableRef } from '../../schemaRef'
import type { DialectId } from '../../dialects'
import { NO_VALUE_OPS as NO_VALUE, type Filter } from '@shared/db/savedFilter'

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

// 필터의 모양은 저장 필터(메인 저장소)와 함께 쓰므로 `@shared/db/savedFilter` 가 정본이다.
// 여기서 다시 내보내는 건 이 모듈로 들어오던 기존 import 를 그대로 두기 위해서다.
export { FILTER_OPS, NO_VALUE_OPS } from '@shared/db/savedFilter'
export type { Filter, FilterOp } from '@shared/db/savedFilter'

export interface SelectOptions {
  limit: number
  offset: number
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }
  filters?: Filter[]
}

/**
 * 필터 → `WHERE …` 조각과 바인드 값. **조회와 행 수 세기가 이 한 함수를 같이 쓴다** —
 * 절을 두 벌로 만들면 한쪽만 고쳐져 "보이는 행 수"와 "총 쪽수"가 조용히 어긋난다.
 * 조건이 없으면 빈 문자열(앞의 공백까지 포함)을 돌려줘 부르는 쪽이 그냥 이어 붙이면 된다.
 */
function whereClause(dialect: SqlDialect, filters: readonly Filter[] | undefined): Statement {
  const q = (n: string): string => quoteIdent(dialect, n)
  const params: unknown[] = []
  let i = 1
  const clauses = (filters ?? [])
    .filter((f) => f.column && (NO_VALUE.includes(f.op) || f.value !== ''))
    .map((f) => {
      if (f.op === 'IS NULL') return `${q(f.column)} IS NULL`
      if (f.op === 'IS NOT NULL') return `${q(f.column)} IS NOT NULL`
      params.push(f.value)
      return `${q(f.column)} ${f.op} ${ph(dialect, i++)}`
    })
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params }
}

/** SELECT * … [WHERE …] [ORDER BY …] LIMIT/OFFSET. WHERE 값은 파라미터 바인드(문자열 조립 금지). */
export function buildSelect(dialect: SqlDialect, table: TableRef, opts: SelectOptions): Statement {
  const q = (n: string): string => quoteIdent(dialect, n)
  const where = whereClause(dialect, opts.filters)
  let sql = `SELECT * FROM ${quoteTable(dialect, table)}${where.sql}`

  if (opts.orderBy) {
    sql += ` ORDER BY ${q(opts.orderBy.column)} ${opts.orderBy.direction === 'DESC' ? 'DESC' : 'ASC'}`
  }
  sql += ` LIMIT ${safeInt(opts.limit)} OFFSET ${safeInt(opts.offset)}`
  return { sql, params: where.params }
}

/**
 * 조건에 맞는 **전체 행 수**. 총 쪽수를 알려면 이게 필요한데, 행이 아주 많은 표에선 몇 초가
 * 걸린다 — 그래서 조회와 **따로** 띄우고(§db-remote.data.paging AC-4) 여기엔 정렬·LIMIT 을
 * 붙이지 않는다(결과가 한 줄이라 무의미하고, 정렬은 셈을 느리게만 한다).
 */
export function buildCount(
  dialect: SqlDialect,
  table: TableRef,
  filters?: readonly Filter[]
): Statement {
  const where = whereClause(dialect, filters)
  return {
    sql: `SELECT COUNT(*) AS total FROM ${quoteTable(dialect, table)}${where.sql}`,
    params: where.params
  }
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
