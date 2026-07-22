/**
 * 파라미터화 쿼리 키워드 유틸(§ops 향상 — Query Tier A). 레거시 `{{키워드}}` 치환 이식.
 * - bare `{{name}}` 만 대상. 작은따옴표로 감싼 `'{{name}}'` 는 리터럴로 두고 치환하지 않는다.
 * - 값이 숫자/NULL 이면 그대로, 문자열이면 자동 싱글쿼트 + 이스케이프.
 * 순수 함수 → 테스트 의무 대상.
 */
const TOKEN = /\{\{\s*(\w+)\s*\}\}/g

/** 매치가 `'...'` 로 감싸졌는지(바로 앞·뒤 문자가 작은따옴표). */
function isQuoted(sql: string, offset: number, len: number): boolean {
  return sql[offset - 1] === "'" && sql[offset + len] === "'"
}

/** bare 키워드 이름을 등장 순서대로 유일하게 추출(quoted 제외). */
export function extractKeywords(sql: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of sql.matchAll(TOKEN)) {
    if (isQuoted(sql, m.index ?? 0, m[0].length)) continue
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

/** 값 포맷 — 숫자/NULL 은 raw, 그 외는 싱글쿼트+이스케이프. */
export function formatValue(v: string): string {
  const s = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  if (s.toUpperCase() === 'NULL') return 'NULL'
  return `'${v.replace(/'/g, "''")}'`
}

/** 제공된 값으로 bare 키워드를 치환. 값 없는 키워드/quoted 는 그대로 둔다. */
export function applyKeywords(sql: string, values: Record<string, string>): string {
  return sql.replace(TOKEN, (match, name: string, offset: number) => {
    if (isQuoted(sql, offset, match.length)) return match
    if (!(name in values)) return match
    return formatValue(values[name])
  })
}
