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

/** folderId 의 모든 자손 폴더 id 집합(자기 자신 제외). 폴더를 자기 자손으로 옮기는 순환 방지에 쓴다. */
export function folderDescendants(nodes: LibNode[], folderId: string): Set<string> {
  const out = new Set<string>()
  const stack = [folderId]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const n of nodes) {
      if (n.parentId === cur && n.kind === 'folder' && !out.has(n.id)) {
        out.add(n.id)
        stack.push(n.id)
      }
    }
  }
  return out
}

export interface MoveTarget {
  id: string | null
  label: string
  depth: number
}

/**
 * "이동(Move to)" 대상 폴더 목록 — (최상위) + 모든 폴더(트리 DFS 순서, 중첩 경로 라벨 'A / 하위').
 * 옮길 노드가 폴더면 자기 자신과 자손 폴더는 제외한다(자기 안으로 넣는 순환 방지).
 */
export function moveTargets(nodes: LibNode[], nodeId: string): MoveTarget[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const node = byId.get(nodeId)
  const excluded = node?.kind === 'folder' ? folderDescendants(nodes, node.id) : new Set<string>()
  if (node?.kind === 'folder') excluded.add(node.id)
  const pathLabel = (id: string): string => {
    const parts: string[] = []
    let cur = byId.get(id)
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return parts.join(' / ')
  }
  const targets: MoveTarget[] = [{ id: null, label: '(최상위)', depth: 0 }]
  for (const n of flattenTree(nodes)) {
    if (n.kind !== 'folder' || excluded.has(n.id)) continue
    targets.push({ id: n.id, label: pathLabel(n.id), depth: n.depth })
  }
  return targets
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
  const maxDepth = prev ? prev.depth + (prev.kind === 'folder' ? 1 : 0) : 0
  // depth 는 가로 드래그(activeItem.depth + delta)가 [0, maxDepth] 안에서 결정한다.
  // next.depth 를 하한(minDepth)으로 쓰지 않는다 — 폴더의 첫 자식 위에 얹었을 때
  // next(=자식)가 하한을 올려 버리면 왼쪽으로 아무리 끌어도 루트(depth 0)에 못 닿는다(폴더로만 잡힘).
  let depth = activeItem.depth + dragDepthDelta
  if (depth > maxDepth) depth = maxDepth
  if (depth < 0) depth = 0

  let parentId = parentIdAtDepth(items, overIndex, depth, activeId)
  // 부모가 쿼리(리프)면 폴더가 아니므로 한 단계 위로.
  const parent = items.find((i) => i.id === parentId)
  if (parent && parent.kind === 'query') parentId = parent.parentId
  return { depth: Math.max(0, depth), parentId }
}
