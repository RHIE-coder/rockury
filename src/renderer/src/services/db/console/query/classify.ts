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

/**
 * SQL 을 문(statement) 단위로 나눈다 — 세미콜론 기준이되 문자열/식별자 인용·주석 안의 `;` 는 무시한다.
 * (main splitStatements 와 같은 규칙의 렌더러판 — 실행 라우팅 판정에만 쓴다.) 순수 함수 → 테스트 의무.
 */
export function splitSql(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null // "'" | '"' | '`'
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (quote) {
      cur += ch
      if (ch === quote) {
        if (ch === "'" && next === "'") { cur += next; i += 2; continue } // '' 이스케이프
        quote = null
      }
      i++
      continue
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? n : end
      cur += sql.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      cur += sql.slice(i, stop)
      i = stop
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; i++; continue }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue }
    cur += ch
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * 스크립트(여러 문) 전체의 실행 성격을 판정한다 — 라우팅 안전용.
 * 어느 한 문장이라도 DML 이면 **전체를 트랜잭션 게이트로**(뒤에 숨은 DML 이 자동 커밋되는 구멍 차단).
 * DDL 만 섞였으면 ddl(자동 커밋 경고), 전부 읽기면 read. 단일 문은 classifyStatement 와 동일.
 */
export function classifyScript(sql: string): StatementClass {
  const classes = splitSql(sql)
    .map(classifyStatement)
    .filter((c) => c.kind !== 'empty')
  if (classes.length === 0) return { kind: 'empty', verb: '', destructive: false }
  if (classes.length === 1) return classes[0]
  const destructive = classes.some((c) => c.destructive)
  if (classes.some((c) => c.kind === 'dml')) return { kind: 'dml', verb: '여러 문', destructive }
  if (classes.some((c) => c.kind === 'ddl')) return { kind: 'ddl', verb: '여러 문', destructive }
  return { kind: 'read', verb: '여러 문', destructive: false }
}
