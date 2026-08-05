import type { ModuleArea, View } from './types'

/**
 * 뷰 탭 줄의 묶음 배치 규칙(순수) — 셸에서 떼어내 테스트로 못박는다.
 *
 * 뷰가 여럿인 모듈 중에는 **줄 하나에 성격이 다른 일이 섞여 있는** 곳이 있다. DB 의 Migration 이
 * 그렇다: Plan·Run·Seed 는 설계를 실제에 반영하고, 가져오기는 반대로 실제를 설계로 들이며,
 * Drift 는 어느 쪽도 아닌 진단이고, Compare·Logs 는 방향이 없다. 이름표 없이 한 줄에 세워 두면
 * 줄만 봐서는 그 갈래가 안 읽힌다(2026-08-04 사용자 요청).
 */

export interface ViewGroupRun {
  /** 묶음 이름표. 없으면 이름표 없이 구분선만 선다. */
  label?: string
  /** 이름표 색조 — 그 흐름이 출발하는 부서. */
  tone?: ModuleArea
  views: View[]
}

/**
 * 뷰 목록을 **이웃한 같은 이름표끼리** 묶는다(등록 순서 유지).
 *
 * 이름표가 없는 뷰들도 이웃끼리 한 묶음이 된다 — 그래야 Compare·Logs 사이에 쓸데없는 구분선이
 * 안 선다. 떨어져 있는 같은 이름표는 **합치지 않는다**: 줄 위의 자리가 곧 흐름의 순서라,
 * 합치면 등록 순서가 조용히 뒤집힌다.
 */
export function groupViews(views: readonly View[]): ViewGroupRun[] {
  const runs: ViewGroupRun[] = []
  for (const v of views) {
    const last = runs[runs.length - 1]
    if (last && last.label === v.group) last.views.push(v)
    else runs.push({ label: v.group, tone: v.groupTone, views: [v] })
  }
  return runs
}

/**
 * 이 줄이 **이름표 단을 쓰는가.** 하나라도 이름표가 있으면 단이 서고, 없으면 통째로 안 선다.
 *
 * 회귀(2026-08-05): 이름표 없는 묶음에도 빈 줄을 세워 밑선을 맞췄더니, 그 빈 줄이 다섯 서비스
 * **모든 화면**의 탭 줄을 한 단씩 높였다. 이름표를 쓰는 모듈은 지금 Migration 하나뿐인데
 * 나머지 전부가 값을 치른 것이다. 밑선 맞춤은 이름표를 쓰는 줄 **안에서만** 필요한 문제다.
 */
export function hasGroupLabels(runs: readonly ViewGroupRun[]): boolean {
  return runs.some((r) => !!r.label)
}
