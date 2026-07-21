/**
 * 히스토리 dedup 키(§ops 향상 — Query 히스토리). 순수 → 테스트 의무 대상.
 * 공백 정규화 후 비교해 "같은 쿼리 연속 실행"을 한 항목으로 접는다(rky 는 dedup 없음).
 */
export function normalizeSqlKey(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ')
}

export function isSameQuery(a: string, b: string): boolean {
  return normalizeSqlKey(a) === normalizeSqlKey(b)
}
