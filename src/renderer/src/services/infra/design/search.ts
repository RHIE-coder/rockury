import { absolutePos } from './nesting'
import type { DesignNode } from './types'
import type { NodeTypeDef } from '../catalog/types'

/**
 * 설계본 노드 검색과 포커싱의 **순수 계산**.
 * 명세: `docs/spec/infra-architecture.md` §design.canvas AC-7.
 *
 * 팔레트(왼쪽 목록)의 '종류 검색'과는 다른 것이다 — 저건 *놓을 종류*를 고르는 거르개이고,
 * 이건 *이미 놓인 노드*를 찾는 것이다. 둘을 한 칸으로 합치면 "찾았는데 안 보인다"가 된다.
 */

/**
 * 포커싱할 때 넘지 않는 배율.
 * 상한이 없으면 노드 하나가 화면을 가득 채워, 찾은 노드가 무엇 **옆에** 있는지가 사라진다 —
 * 인프라 그림에서는 이웃이 곧 정보다.
 */
export const FOCUS_MAX_ZOOM = 1.2

/**
 * 이름·종류로 노드를 찾는다. **이름이 맞은 것이 먼저** 나온다 —
 * 종류로 걸린 것은 대개 여러 개라, 섞어 놓으면 이름을 정확히 아는 사람이 자기 노드를 못 찾는다.
 * 검색어가 비면 빈 배열이다(전부 주면 목록이 소음이 된다).
 */
export function searchNodes(
  nodes: DesignNode[],
  types: Record<string, NodeTypeDef>,
  query: string
): DesignNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const byName: DesignNode[] = []
  const byType: DesignNode[] = []
  for (const n of nodes) {
    if (n.name.toLowerCase().includes(q)) {
      byName.push(n)
      continue
    }
    const t = n.typeId ? types[n.typeId] : undefined
    // 카탈로그에서 사라진 종류라도 id 는 노드에 남아 있으므로 그걸로도 걸리게 둔다.
    const typeText = `${t?.label ?? ''} ${n.typeId ?? ''}`.toLowerCase()
    if (typeText.includes(q)) byType.push(n)
  }
  return [...byName, ...byType]
}

export interface FocusTarget {
  x: number
  y: number
  zoom: number
}

/**
 * 이 노드를 화면 가운데 두려면 어디를 봐야 하나 — 노드 한가운데의 **절대** 좌표.
 * 지금 배율이 상한보다 크면 상한으로 낮추고, 작으면 **그대로 둔다**(사용자가 일부러 넓게 본 것이다).
 * 없는 노드면 `null` — 화면이 엉뚱한 곳으로 튀는 것보다 아무 일도 안 하는 게 낫다.
 */
export function focusTarget(
  nodes: DesignNode[],
  nodeId: string,
  currentZoom: number
): FocusTarget | null {
  const n = nodes.find((x) => x.id === nodeId)
  if (!n) return null
  const p = absolutePos(nodes, n.id)
  return {
    x: p.x + n.w / 2,
    y: p.y + n.h / 2,
    zoom: Math.min(currentZoom, FOCUS_MAX_ZOOM)
  }
}
