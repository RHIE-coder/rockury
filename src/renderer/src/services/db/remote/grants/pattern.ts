/**
 * 세트 패턴 전개(§db-remote.grants.sets AC-5) — `*` 와일드카드 + 선택적 `스키마.` 한정.
 * SQL 의 `%` 대신 `*` 를 쓰는 이유: SQL 편집기 밖 화면에서 `%` 는 낯설다(spec 결정).
 * 첫 `.` 까지가 스키마 한정 — 점이 든 테이블 이름은 못 가리킨다(알려진 한계, 주석으로 남김).
 */

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `orders_*` → /^orders_.*$/ — `*` 만 와일드카드, 나머지는 글자 그대로. */
function toRegex(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map(escapeRe).join('.*')}$`)
}

export function expandPattern(
  pattern: string,
  tables: { db: string; table: string }[]
): { db: string; table: string }[] {
  const dot = pattern.indexOf('.')
  const dbGlob = dot >= 0 ? pattern.slice(0, dot) : null
  const tableGlob = dot >= 0 ? pattern.slice(dot + 1) : pattern
  if (!tableGlob) return []
  const dbRe = dbGlob ? toRegex(dbGlob) : null
  const tableRe = toRegex(tableGlob)
  return tables.filter((t) => tableRe.test(t.table) && (!dbRe || dbRe.test(t.db)))
}
