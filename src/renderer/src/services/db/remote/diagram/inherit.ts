import type { Viewport } from '@xyflow/react'
import type { Positions } from './layout'
import type { DiagramGroup } from './group'

/** 물려받아 화면에 깔린 배치 한 벌 — 아직 이 스코프에 자기 기록이 없을 때만 있다. */
export interface InheritedLayout {
  positions: Positions
  viewport: Viewport | null
  groups: DiagramGroup[]
}

/** 저장 패치 — 안 넘긴 항목은 저장소가 그대로 둔다(부분 갱신). */
export interface LayoutPatch {
  positions?: Positions
  viewport?: Viewport | null
  groups?: DiagramGroup[]
}

/**
 * 물려받은 배치를 **첫 저장에 실어 준다**(순수).
 *
 * 저장이 부분 갱신이라, 물려받은 상태에서 그룹만 넘기면 새로 생긴 행에는 그 그룹만 남고
 * 눈에 보이던 위치·화면이 통째로 빈다 — 다음에 그 버전을 열면 그림이 흩어진다.
 * 그래서 자기 행을 처음 만드는 저장에는 안 넘어온 항목을 물려받은 값으로 채운다.
 *
 * `inherited` 가 없으면(이미 자기 행이 있다) 패치를 그대로 둔다.
 * 명시로 넘긴 값은 언제나 이긴다 — 자동 배치의 `positions: {}` · `viewport: null` 이 그 경우다.
 */
export function withInheritedLayout(inherited: InheritedLayout | null, patch: LayoutPatch): LayoutPatch {
  if (!inherited) return patch
  return {
    positions: patch.positions ?? inherited.positions,
    viewport: patch.viewport === undefined ? inherited.viewport : patch.viewport,
    groups: patch.groups ?? inherited.groups
  }
}
