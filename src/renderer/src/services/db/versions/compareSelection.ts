/**
 * 타임라인에서 **비교할 두 버전 고르기**(2026-08-03 사용자 결정 — Version Diff 를 따로 뜬 화면에서
 * Versions 안 패널로 접었다). 화면에서 떼어내 순수 함수로 둔다: 고르는 순서와 시간 순서가
 * 엇갈리는 자리라, 눈으로 보고 고치기엔 틀린 게 안 보인다.
 */

/**
 * 고르기 토글 — 두 개까지 담고, 셋째를 고르면 **가장 먼저 고른 것**이 빠진다.
 *
 * 꽉 찼을 때 새 선택을 막지 않는 이유: 막으면 "먼저 하나 풀어라"는 막다른 길이 생겨,
 * 버전을 죽 훑으며 견주는 흐름이 매번 끊긴다.
 */
export function togglePick(picked: readonly string[], id: string): string[] {
  if (picked.includes(id)) return picked.filter((p) => p !== id)
  return [...picked, id].slice(-2)
}

/**
 * 고른 둘을 시간 순으로 세운다 — 목록은 **최신이 위**라 아래쪽이 이전(base)이다.
 * 고른 순서를 그대로 쓰면 아래에서 위로 고른 사람에게 diff 가 거꾸로 나온다.
 */
export function comparePair<T extends { id: string }>(
  versions: readonly T[],
  picked: readonly string[]
): { base: T; target: T } | null {
  if (picked.length !== 2) return null
  const [a, b] = picked.map((id) => versions.findIndex((v) => v.id === id))
  // 목록에서 사라진 버전(삭제된 뒤 고름이 남은 경우)은 비교하지 않는다.
  if (a < 0 || b < 0) return null
  const [older, newer] = a > b ? [a, b] : [b, a]
  return { base: versions[older], target: versions[newer] }
}
