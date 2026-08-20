import type { Module, ModuleArea, ModuleSlot } from './types'

/**
 * 탭 줄 배치 규칙(순수) — 셸에서 떼어내 테스트로 못박는다. 어느 모듈이 줄의 어느 자리에 서고,
 * 어느 구획 손잡이를 자기 줄에 세우는가.
 *
 * 이 규칙은 **다섯 서비스가 함께 쓴다.** 여기서 어긋나면 자리를 안 쓴 서비스의 탭 순서까지
 * 조용히 흐트러지는데, 화면을 열어 보기 전에는 아무도 모른다. 그래서 규칙을 함수로 두고
 * "안 쓰면 예전 그대로"를 테스트가 지킨다.
 */

/** 자리별 모듈 — 안 적은 모듈은 전부 `start` 로 간다(등록 순서 유지). */
export function groupBySlot(modules: readonly Module[]): Record<ModuleSlot, Module[]> {
  const zones: Record<ModuleSlot, Module[]> = { start: [], center: [], end: [] }
  for (const m of modules) zones[m.slot ?? 'start'].push(m)
  return zones
}

/**
 * 이 모듈이 **자기 뷰 탭 줄에 세울 구획 손잡이들**(2026-08-02 사용자 요청 — 손잡이는 맨 위에
 * 고정하지 않고 그것을 쓰는 화면에 딸려 뜬다).
 *
 * 기본은 자기 구획 하나이고 `common` 은 손잡이가 없다 — 어느 부서의 대상도 안 쓰기 때문이다
 * (DB 의 Reference). 예외는 `Module.handles` 로 직접 적는다.
 */
export function handlesFor(module: Module): ModuleArea[] {
  if (module.handles) return module.handles
  const area = module.area ?? 'common'
  return area === 'common' ? [] : [area]
}

/** 손잡이 줄의 모양(`Module.handleLayout`). 안 적은 모듈은 전부 예전 모양(`'end'`)이다. */
export type HandleLayout = 'end' | 'sides'

/**
 * 이 모듈의 손잡이 줄 모양. **기본이 예전 모양**이라, 안 적은 모듈은 한 글자도 안 바뀐다 —
 * 손잡이 컴포넌트는 다섯 서비스가 함께 쓰므로 기본값이 새 모양이면 아무도 요청하지 않은 화면이
 * 통째로 따라 바뀐다(2026-08-04 에 그렇게 번뜨렸다).
 */
export function handleLayoutFor(module: Module): HandleLayout {
  return module.handleLayout ?? 'end'
}

/** 이웃한 같은 구획끼리 묶은 덩어리. 모듈 줄이 이 덩어리마다 **카드 한 장**을 세운다. */
export interface AreaRun {
  area: ModuleArea
  modules: Module[]
}

/**
 * 모듈을 **이웃한 같은 구획끼리** 묶는다(등록 순서 유지).
 *
 * `areasIn` 과 다르다: 저쪽은 "어느 구획들이 나왔나"(중복 제거)이고, 이쪽은 "줄 위에서 어디부터
 * 어디까지가 한 부서인가"(자리)다. 카드는 자리를 알아야 그린다 — 설계·운영·설계 순으로 섞여
 * 놓이면 카드도 셋이어야지, 둘로 묶으면 순서가 뒤집힌다.
 */
export function areaRuns(modules: readonly Module[]): AreaRun[] {
  const runs: AreaRun[] = []
  for (const m of modules) {
    const area = m.area ?? 'common'
    const last = runs[runs.length - 1]
    if (last && last.area === area) last.modules.push(m)
    else runs.push({ area, modules: [m] })
  }
  return runs
}

/** 한 자리에 나온 구획들(처음 나온 순서). 구획 뱃지는 구획 하나에 하나라 이 목록이 곧 뱃지 목록이다. */
export function areasIn(modules: readonly Module[]): ModuleArea[] {
  const areas: ModuleArea[] = []
  for (const m of modules) {
    const a = m.area ?? 'common'
    if (!areas.includes(a)) areas.push(a)
  }
  return areas
}

/**
 * 이 서비스가 **부서로 갈렸는가** — `common` 말고 다른 구획이 하나라도 있으면 갈린 것이다.
 * 지금은 DB 하나뿐이고(설계부/운영부), 나머지 넷은 구획을 안 쓴다.
 *
 * 강조색이 이걸 본다: 안 갈린 서비스에서 `common` 은 "어느 부서도 아님"이 아니라 그냥
 * **부서 개념이 없음**이라, 중립색으로 칠하면 구획을 쓰지도 않는 네 서비스의 활성 탭 색이
 * 통째로 바뀐다. 갈린 서비스에서만 공통이 중립이 된다.
 */
export function isAreaSplit(modules: readonly Module[]): boolean {
  return areasIn(modules).some((a) => a !== 'common')
}
