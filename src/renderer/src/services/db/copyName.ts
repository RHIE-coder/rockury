/**
 * 겹치지 않는 **사본 이름** 규칙 — `_copy`, `_copy2`, … 중 아무 데도 안 걸리는 첫 번째.
 *
 * 표(다른 설계에서 떠 올 때)와 컬럼(여러 표에 뿌릴 때)이 **같은 규칙**을 쓴다. 사본을 두면
 * 한쪽만 고쳐져서, 같은 "이름이 겹칠 때"가 두 창에서 다르게 굴러간다.
 *
 * `taken` 을 받아 쓰는 이유: 무엇이 "이미 쓰인 이름"인지는 부르는 쪽만 안다 —
 * 표는 (스키마, 이름) 쌍으로, 컬럼은 그 표 안의 이름으로 견준다. 게다가 **이번 배치에서
 * 방금 정해진 이름**도 쓰인 것으로 쳐야 한다(사본 둘이 같은 이름을 받으면 DDL 에서만 터진다).
 */
export function copyName(base: string, taken: (name: string) => boolean): string {
  if (!taken(`${base}_copy`)) return `${base}_copy`
  let n = 2
  while (taken(`${base}_copy${n}`)) n++
  return `${base}_copy${n}`
}
