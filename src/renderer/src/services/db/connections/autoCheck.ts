/**
 * 자동 확인(Connections 페이지 진입·새로고침) 대상 판정 — 순수 로직.
 *
 * "자동 확인 무시(autoCheckDisabled)"가 켜진 연결은 제외한다. 카드별 수동 테스트(Plug)는
 * 이 필터와 무관하게 항상 동작하므로, 제외된 연결(SSH 터널 등)의 수동 확인 탈출구가 된다.
 * store.ts 는 모듈 로드 시 window.rockury 를 건드려 node 테스트에서 못 부르므로 여기 분리해 둔다.
 */
export interface AutoCheckPartition<T> {
  /** 이번 자동 확인이 실제로 검사할 연결 */
  targets: T[]
  /** 제외돼 건너뛰는 연결 — 호출부는 이들의 잔존 상태를 '미확인'으로 되돌려야 한다(옛 실패가 방금 결과처럼 읽히는 오해 방지) */
  skipped: T[]
}

export function partitionAutoCheck<T extends { autoCheckDisabled: boolean }>(
  connections: T[]
): AutoCheckPartition<T> {
  const targets: T[] = []
  const skipped: T[] = []
  for (const c of connections) (c.autoCheckDisabled ? skipped : targets).push(c)
  return { targets, skipped }
}

export function autoCheckTargets<T extends { autoCheckDisabled: boolean }>(connections: T[]): T[] {
  return partitionAutoCheck(connections).targets
}
