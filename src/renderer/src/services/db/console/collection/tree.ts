/**
 * 저장 쿼리 라이브러리 트리 유틸(§ops 향상 — Collection). dnd-kit sortable-tree 방식 이식.
 * 폴더(자식 가능) + 쿼리(리프)를 평탄화하고, 드래그 투영으로 목표 parent/depth 를 계산한다.
 * 순수 함수 → 테스트 의무 대상.
 */
export type NodeKind = 'folder' | 'query'

export interface LibNode {
  id: string
  parentId: string | null
  kind: NodeKind
  name: string
  sql?: string
  sortOrder: number
}

export interface FlatNode extends LibNode {
  depth: number
}

/** parentId 계층을 DFS 로 평탄화(정렬: sortOrder→name). 폴더 먼저, 그다음 쿼리. */
export function flattenTree(nodes: LibNode[]): FlatNode[] {
  const byParent = new Map<string | null, LibNode[]>()
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n)
    byParent.set(n.parentId, arr)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    })
  }
  const out: FlatNode[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ ...n, depth })
      if (n.kind === 'folder') walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** id 집합의 모든 자손을 평탄 목록에서 제거(자기 자신 안으로 드롭 방지 등). */
export function removeChildrenOf(items: FlatNode[], ids: string[]): FlatNode[] {
  const exclude = new Set(ids)
  return items.filter((item) => {
    if (item.parentId && exclude.has(item.parentId)) {
      if (item.kind === 'folder') exclude.add(item.id)
      return false
    }
    return true
  })
}

function parentIdAtDepth(items: FlatNode[], overIndex: number, depth: number, activeId: string): string | null {
  if (depth === 0) return null
  if (overIndex <= 0) return null
  const prev = items[overIndex - 1]
  if (!prev) return null
  if (depth === prev.depth) return prev.parentId
  if (depth > prev.depth) return prev.kind === 'folder' ? prev.id : prev.parentId
  // depth < prev.depth — 위쪽에서 같은 depth 의 형제를 찾아 그 부모를 쓴다.
  const candidate = items
    .slice(0, overIndex)
    .reverse()
    .find((i) => i.depth === depth && i.id !== activeId)
  return candidate?.parentId ?? null
}

export interface Projection {
  depth: number
  parentId: string | null
}

/**
 * 드래그 투영 — active 를 over 위치에 depth 오프셋만큼 옮길 때의 목표 depth/parent.
 * 쿼리는 자식을 못 가지므로 부모가 쿼리로 잡히면 그 부모의 부모로 보정.
 */
export function getProjection(
  items: FlatNode[],
  activeId: string,
  overId: string,
  dragDepthDelta: number
): Projection {
  const overIndex = items.findIndex((i) => i.id === overId)
  const activeItem = items.find((i) => i.id === activeId)
  if (overIndex < 0 || !activeItem) return { depth: 0, parentId: null }

  const prev = items[overIndex - 1]
  const next = items[overIndex + 1]
  const maxDepth = prev ? prev.depth + (prev.kind === 'folder' ? 1 : 0) : 0
  const minDepth = next ? next.depth : 0
  let depth = activeItem.depth + dragDepthDelta
  if (depth > maxDepth) depth = maxDepth
  if (depth < minDepth) depth = minDepth

  let parentId = parentIdAtDepth(items, overIndex, depth, activeId)
  // 부모가 쿼리(리프)면 폴더가 아니므로 한 단계 위로.
  const parent = items.find((i) => i.id === parentId)
  if (parent && parent.kind === 'query') parentId = parent.parentId
  return { depth: Math.max(0, depth), parentId }
}
