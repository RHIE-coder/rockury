/**
 * 표에 보일 컬럼 이름과 그 순서.
 *
 * 조회는 `SELECT *` 라 행에는 **실 DB 가 지금 가진 컬럼**이 담기고, 헤더는 역설계 결과에서 온다.
 * 둘이 어긋나면 화면은 옛 이름으로 행의 값을 꺼내게 되고 **모든 칸이 `undefined`** 로 보인다
 * (2026-08-04 실측: 밖에서 실 DB 스키마를 고친 뒤 Data 새로고침을 누른 상황).
 *
 * 그래서 역설계 순서를 **우선하되, 실제 결과에 없는 컬럼은 빼고 결과에만 있는 컬럼은 뒤에 붙인다.**
 * 순서는 사람이 설계한 대로 남고, 어긋난 순간에도 빈 칸이 아니라 실제 데이터가 보인다.
 */
export function displayColumns(introspected: string[], result: string[]): string[] {
  // 역설계를 아직 못 읽었으면 결과가 유일한 근거다.
  if (introspected.length === 0) return result
  // 결과 컬럼이 없으면(빈 표) 헤더를 지우지 않는다 — 표의 모양은 행이 0개여도 보여야 한다.
  if (result.length === 0) return introspected

  const inResult = new Set(result)
  const known = new Set(introspected)
  return [
    ...introspected.filter((c) => inResult.has(c)),
    ...result.filter((c) => !known.has(c))
  ]
}
