import type { NodeTypeDef } from '../catalog/types'
import { BOX_HEADER, BOX_PAD, DEFAULT_NODE_H, DEFAULT_NODE_W, type DesignNode } from './types'

export type NestCheck = { ok: true } | { ok: false; reason: string }

/**
 * 이 종류를 저 부모 안에 넣을 수 있나.
 *
 * 규칙은 **양쪽이 다 종류를 가질 때만** 구속한다. 종류 없는 맨 노드, 카탈로그에서 사라진 종류는
 * 규칙을 적용할 근거가 없으므로 허용한다 — 그리기를 못 하게 만드는 쪽이 더 나쁜 실패다.
 * 거절할 때는 **반드시 이유를 준다.** 이유 없이 안 놓이면 사용자는 앱이 고장 났다고 여긴다.
 */
export function canNest(
  childTypeId: string | null,
  parentTypeId: string | null,
  types: Record<string, NodeTypeDef>
): NestCheck {
  if (parentTypeId === null) return { ok: true } // 최상위(캔버스) 또는 맨 노드 안 — 규칙 없음
  if (childTypeId === null) return { ok: true }

  const child = types[childTypeId]
  const parent = types[parentTypeId]
  if (!child || !parent) return { ok: true } // 사라진 종류 — 판정 근거가 없다

  // 부모 쪽 허가가 먼저다 — 묶음 상자·서버처럼 "아무거나 담는" 종류는 자식이 자기를 등재할 수 없다.
  const contains = parent.canContain ?? []
  if (contains.includes('*') || contains.includes(childTypeId)) return { ok: true }

  const allowed = child.canNestIn ?? []
  if (allowed.length === 0) {
    return { ok: false, reason: `'${child.label}' 은 최상위에만 놓을 수 있습니다(담길 부모가 선언돼 있지 않습니다).` }
  }
  if (allowed.includes(parentTypeId)) return { ok: true }

  const names = allowed.map((id) => types[id]?.label ?? id).join(' · ')
  return {
    ok: false,
    reason: `'${child.label}' 은 '${parent.label}' 안에 들어갈 수 없습니다. 넣을 수 있는 곳: ${names}`
  }
}

/** 자기 자신 + 모든 자손의 id. 순환 판정과 삭제 파급에 함께 쓴다. */
export function descendantIds(nodes: DesignNode[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const list = childrenOf.get(n.parentId) ?? []
    list.push(n.id)
    childrenOf.set(n.parentId, list)
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    for (const child of childrenOf.get(id) ?? []) {
      if (out.has(child)) continue
      out.add(child)
      stack.push(child)
    }
  }
  return out
}

/** 자기 안(또는 자기 자손 안)으로 들어가려 하나. 이걸 막지 않으면 트리가 끊긴 고리로 남는다. */
export function wouldCycle(nodes: DesignNode[], nodeId: string, newParentId: string | null): boolean {
  if (newParentId === null) return false
  return descendantIds(nodes, nodeId).has(newParentId)
}

/**
 * 부모 기준 상대 좌표를 캔버스 절대 좌표로 누적한다.
 * 부모 참조가 끊겨 있어도(카탈로그·노드가 지워진 뒤) 크래시하지 않고 자기 좌표를 쓴다.
 */
export function absolutePos(nodes: DesignNode[], nodeId: string): { x: number; y: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur = byId.get(nodeId)
  let x = 0
  let y = 0
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    x += cur.x
    y += cur.y
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return { x, y }
}

/**
 * 자식들을 모두 감싸는 부모 크기.
 * 자식 좌표가 부모 기준 상대값이므로 오른쪽·아래 끝에 여백만 더하면 된다.
 */
export function fitParentSize(children: DesignNode[]): { w: number; h: number } {
  const minW = DEFAULT_NODE_W + BOX_PAD * 2
  const minH = BOX_HEADER + DEFAULT_NODE_H + BOX_PAD
  if (children.length === 0) return { w: minW, h: minH }

  let right = 0
  let bottom = 0
  for (const c of children) {
    right = Math.max(right, c.x + c.w)
    bottom = Math.max(bottom, c.y + c.h)
  }
  return { w: Math.max(minW, right + BOX_PAD), h: Math.max(minH, bottom + BOX_PAD) }
}
