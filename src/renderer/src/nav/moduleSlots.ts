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

/**
 * 구획 뱃지가 그 구획 묶음의 **어느 끝**에 붙는가 — 다리(건너가는 모듈로 이어지는 선) 쪽 끝이다
 * (2026-08-03 사용자 요청 — "설계 뱃지가 Migration 버튼 선이랑 연결되는 느낌이 되게").
 * 선을 눈으로 따라가면 그 끝에 부서 이름이 서 있어, 다리가 어디서 어디로 건너는지가 한눈에 읽힌다.
 *
 * **다리가 있을 때만** 자리를 옮긴다. api·infra 는 구획을 쓰지만 건너가는 모듈이 없어 선도 없다 —
 * 거기서도 옮기면 뱃지가 묶음 뒤로 밀려, 가리킬 선도 없이 "이 탭들의 이름표"라는 뜻만 흐려진다.
 */
export function chipSide(slot: ModuleSlot, crossing: boolean): 'leading' | 'trailing' {
  if (!crossing) return 'leading'
  // 다리는 줄 가운데(center)에 있다 — 왼쪽 묶음은 뒤끝이, 오른쪽 묶음은 앞끝이 다리를 향한다.
  return slot === 'end' ? 'leading' : 'trailing'
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
 * 지금은 DB 하나뿐이고(설계부/운영부), 나머지 넷은 구획을 안 쓴다(`docs/spec/uiux-ia.md`).
 *
 * 강조색이 이걸 본다: 안 갈린 서비스에서 `common` 은 "어느 부서도 아님"이 아니라 그냥
 * **부서 개념이 없음**이라, 중립색으로 칠하면 구획을 쓰지도 않는 네 서비스의 활성 탭 색이
 * 통째로 바뀐다. 갈린 서비스에서만 공통이 중립이 된다.
 */
export function isAreaSplit(modules: readonly Module[]): boolean {
  return areasIn(modules).some((a) => a !== 'common')
}
