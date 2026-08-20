import type { SurfaceContent } from '../types'
import { findComponent } from '../tree'

/**
 * 끌어놓기 계산
 *
 * **좌표는 여기서만 쓰이고 저장되지 않는다.** 화면에서 잰 사각형과 포인터 위치로 "어느 영역의
 * 몇 번째"를 정하고 나면, 남는 것은 순서뿐이다 — 그래서 끌어 옮겨도 결과가 여전히 구조다.
 *
 * 미리보기는 좁은 자리에서 `scale()` 로 줄어 있는데, **잰 사각형도 포인터도 똑같이 화면 좌표**라
 * 그대로 비교하면 된다(축척을 따로 나눌 필요가 없다 — 나누면 오히려 어긋난다).
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 미리보기에서 잰 요소 하나. `nodes` 는 **문서 순서**로 온다(그 순서가 곧 배치 순서다). */
export interface NodeRect {
  id: string
  sectionId: string
  rect: Rect
}

export interface SectionRect {
  id: string
  rect: Rect
  /** 가로·격자 배치면 좌우로, 세로면 위아래로 가른다. */
  horizontal: boolean
}

export interface DropTarget {
  sectionId: string
  /** `moveComponent` 에 그대로 넣는 자리 — **끌던 것을 뺀 뒤**의 인덱스다(아래 설명). */
  index: number
}

/** 드래그로 볼지 클릭으로 볼지 가르는 거리. 손이 미세하게 흔들려도 클릭이 드래그로 바뀌지 않게. */
export const DRAG_THRESHOLD = 4

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * 포인터가 놓인 자리 → 넣을 곳. 어느 영역에도 안 걸리면 null(놓아도 아무 일 없음).
 *
 * 세는 대상에서 **끌고 있는 것을 뺀다.** 그래서 나온 인덱스가 곧 `moveComponent` 가 기대하는
 * "뽑아낸 뒤의 자리"가 된다 — 따로 변환하지 않는다(변환을 두면 두 기준이 생겨 언젠가 어긋난다).
 */
export function dropTarget(
  point: { x: number; y: number },
  sections: SectionRect[],
  nodes: NodeRect[],
  draggingId: string
): DropTarget | null {
  // 영역이 겹치면 나중 것(더 안쪽에 그려진 것)을 쓴다.
  const section = [...sections].reverse().find((s) => contains(s.rect, point.x, point.y))
  if (!section) return null

  const others = nodes.filter((n) => n.sectionId === section.id && n.id !== draggingId)

  let index = 0
  for (const node of others) if (isAfter(point, node.rect, section.horizontal)) index++
  return { sectionId: section.id, index }
}

/**
 * 포인터가 이 요소보다 **뒤**인가.
 *
 * 세로로 쌓인 것은 위아래 중심으로 가르면 끝이다. 가로·격자는 **줄이 여럿일 수 있어서**
 * 좌우만 보면 아랫줄 요소가 윗줄 것보다 앞으로 판정된다 — 그래서 줄부터 가른다
 * (읽는 순서 그대로: 아랫줄이면 무조건 뒤, 같은 줄이면 좌우 중심).
 */
function isAfter(point: { x: number; y: number }, rect: Rect, horizontal: boolean): boolean {
  if (!horizontal) return point.y > (rect.top + rect.bottom) / 2
  if (point.y > rect.bottom) return true
  if (point.y < rect.top) return false
  return point.x > (rect.left + rect.right) / 2
}

/**
 * 끌어다 놓은 자리가 원래 자리와 같은가. 같으면 옮기지 않는다 — 안 그러면 제자리에 놓기만 해도
 * 저장이 한 번 돌아 이력이 지저분해진다.
 */
export function isSamePlace(content: SurfaceContent, draggingId: string, target: DropTarget): boolean {
  const found = findComponent(content, draggingId)
  if (!found) return true
  if (found.section.id !== target.sectionId) return false
  const currentIndex = found.section.components.findIndex((c) => c.id === draggingId)
  // 목표 인덱스는 "뽑아낸 뒤" 기준이라, 제자리는 곧 지금 인덱스와 같다.
  return currentIndex === target.index
}

/**
 * 드롭 자리를 눈에 보이는 선으로. 넣을 곳 **앞뒤 요소 사이**에 긋는다 —
 * 요소 위에 겹쳐 그리면 "이 위에 얹는다"로 읽혀 뜻이 달라진다.
 */
export function guideLine(
  target: DropTarget,
  sections: SectionRect[],
  nodes: NodeRect[],
  draggingId: string
): { left: number; top: number; width: number; height: number } | null {
  const section = sections.find((s) => s.id === target.sectionId)
  if (!section) return null
  const others = nodes.filter((n) => n.sectionId === section.id && n.id !== draggingId)

  const before = others[target.index - 1]
  const after = others[target.index]

  if (section.horizontal) {
    const x = after
      ? after.rect.left - 2
      : before
        ? before.rect.right + 1
        : section.rect.left + 2
    const top = (after ?? before)?.rect.top ?? section.rect.top + 2
    const bottom = (after ?? before)?.rect.bottom ?? section.rect.bottom - 2
    return { left: x, top, width: 2, height: Math.max(bottom - top, 8) }
  }

  const y = after ? after.rect.top - 2 : before ? before.rect.bottom + 1 : section.rect.top + 2
  const left = (after ?? before)?.rect.left ?? section.rect.left + 2
  const right = (after ?? before)?.rect.right ?? section.rect.right - 2
  return { left, top: y, width: Math.max(right - left, 8), height: 2 }
}
