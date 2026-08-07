/**
 * 쪽 넘김 계산(§db-remote.data.paging) — 순수 함수.
 *
 * 총 쪽수는 **모를 수 있다**(`null`). 행 수를 세는 `COUNT(*)` 를 행 조회와 따로 띄우기 때문에,
 * 표가 뜬 직후와 셈이 실패한 뒤에는 쪽수가 없는 상태로 화면이 돌아간다. 그 상태에서
 * 이동까지 막으면 셈이 느린 큰 표에서는 아무 데도 못 간다 — 그래서 "모름"은 위쪽 상한을
 * 걸지 않는다는 규칙이 여기 박혀 있다.
 */

/** 총 쪽수. 행 수를 모르면 `null`. 행이 0이어도 볼 쪽은 한 장이다. */
export function pageCount(totalRows: number | null, pageSize: number): number | null {
  if (totalRows == null) return null
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(totalRows / pageSize))
}

/** 쪽 번호(0부터)를 범위 안으로 당겨 잡는다. 총 쪽수를 모르면 아래쪽만 막는다. */
export function clampPageIndex(index: number, total: number | null): number {
  const floored = Math.max(0, Math.floor(index))
  if (total == null) return floored
  return Math.min(floored, total - 1)
}

/**
 * 입력 칸에 친 글자 → 쪽 번호(0부터). 사람은 1부터 세고 코드는 0부터 세서 한 칸을 옮긴다.
 * 숫자가 아니면 보고 있던 쪽을 그대로 돌려준다 — 빈칸으로 지웠다고 첫 쪽으로 튀지 않게.
 */
export function parsePageInput(text: string, current: number, total: number | null): number {
  const n = Number(text.trim())
  if (text.trim() === '' || !Number.isFinite(n)) return current
  return clampPageIndex(Math.floor(n) - 1, total)
}
