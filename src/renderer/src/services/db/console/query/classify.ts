/**
 * SQL 문 분류(§ops-plan Phase 2c) — 실행 라우팅의 순수 판정(테스트 의무 대상).
 *
 *  - read : SELECT/WITH/SHOW/EXPLAIN/PRAGMA/VALUES … → 바로 실행(결과 그리드)
 *  - dml  : INSERT/UPDATE/DELETE → **트랜잭션 게이트**(BEGIN→영향행수→Confirm/Rollback)
 *  - ddl  : CREATE/ALTER/DROP/… → 바로 실행하되 "자동 커밋" 경고(MySQL 은 롤백 불가)
 *
 * destructive: DROP/TRUNCATE, 또는 WHERE 없는 UPDATE/DELETE(전체 영향) → UI 강한 경고.
 * 선행 주석(-- , /* *\/)은 무시하고 첫 키워드로 판정한다(rky isDdl 결함 회피).
 */
export type StatementKind = 'read' | 'dml' | 'ddl' | 'empty'

export interface StatementClass {
  kind: StatementKind
  verb: string
  destructive: boolean
}

const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT\s+ON)\b/
const DML = /^(INSERT|UPDATE|DELETE)\b/

/** 선행 라인/블록 주석 + 공백 제거(공백이 섞여 여러 개여도 반복 제거). */
export function stripLeadingComments(sql: string): string {
  const re = /^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/
  let s = sql
  let prev: string
  do {
    prev = s
    s = s.replace(re, '')
  } while (s !== prev)
  return s.trim()
}

export function classifyStatement(sql: string): StatementClass {
  const stripped = stripLeadingComments(sql)
  if (!stripped) return { kind: 'empty', verb: '', destructive: false }

  const upper = stripped.toUpperCase()
  const verb = (upper.match(/^\w+/)?.[0] ?? '').toUpperCase()

  if (DDL.test(upper)) {
    return { kind: 'ddl', verb, destructive: verb === 'DROP' || verb === 'TRUNCATE' }
  }
  if (DML.test(upper)) {
    const hasWhere = /\bWHERE\b/.test(upper)
    const destructive = (verb === 'UPDATE' || verb === 'DELETE') && !hasWhere
    return { kind: 'dml', verb, destructive }
  }
  return { kind: 'read', verb, destructive: false }
}
