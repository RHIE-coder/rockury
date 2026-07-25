/**
 * Connections 카드 드래그 앤 드롭 — 순수 계산(기하·순서). DOM 은 ConnectionsView 가 만진다.
 *
 * 표시·전역 순서의 캐논: [그룹들(그룹 목록 순서) 각각의 카드들…, 미분류 카드들] 을 평탄화한 것.
 * 그룹 내 순서는 이 전역 순서에서 파생된다 — 별도의 그룹-로컬 순서 컬럼을 두지 않는다.
 */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Point {
  x: number
  y: number
}

/**
 * 그리드 카드 rect 목록(표시 순서 = 행 우선) 위에서 포인터가 가리키는 삽입 인덱스(0..n).
 * 행은 수직 겹침으로 묶고, 행 안에서는 카드 가로 중심 기준 앞/뒤를 가른다.
 * 포인터가 모든 행 위쪽이면 0, 아래쪽이면 n.
 */
export function insertionIndex(rects: Rect[], p: Point): number {
  if (rects.length === 0) return 0

  interface Row {
    top: number
    bottom: number
    start: number
    end: number // [start, end) — rects 인덱스 구간
  }
  const rows: Row[] = []
  rects.forEach((r, i) => {
    const last = rows[rows.length - 1]
    if (last && r.top < last.bottom && r.bottom > last.top) {
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
      last.end = i + 1
    } else {
      rows.push({ top: r.top, bottom: r.bottom, start: i, end: i + 1 })
    }
  })

  const row = rows.find((rw) => p.y <= rw.bottom)
  if (!row) return rects.length
  for (let i = row.start; i < row.end; i++) {
    const c = rects[i]
    if (p.x < (c.left + c.right) / 2) return i
  }
  return row.end
}

export interface GroupedConn {
  id: string
  groupId: string | null
}

/**
 * 연결들을 섹션(그룹 id | null=미분류)별로 나눈다. 목록에 없는(사라진) 그룹을 가리키는
 * 연결은 미분류로 취급 — 화면에서 카드가 증발하지 않게 하는 안전망.
 */
export function bucketByGroup<T extends GroupedConn>(
  connections: T[],
  groupIds: string[]
): Map<string | null, T[]> {
  const known = new Set(groupIds)
  const buckets = new Map<string | null, T[]>()
  for (const gid of groupIds) buckets.set(gid, [])
  buckets.set(null, [])
  for (const c of connections) {
    const key = c.groupId !== null && known.has(c.groupId) ? c.groupId : null
    buckets.get(key)!.push(c)
  }
  return buckets
}

/**
 * 드롭 결과 → 새 전역 순서(orderedIds).
 * targetIndex 는 "드래그 중인 카드를 뺀" 대상 섹션 카드 목록에서의 삽입 위치(범위 밖이면 클램프).
 * 알 수 없는 대상 그룹은 미분류로 취급한다.
 */
export function applyMove(
  connections: GroupedConn[],
  groupIds: string[],
  connId: string,
  targetGroupId: string | null,
  targetIndex: number
): string[] {
  const rest = connections.filter((c) => c.id !== connId)
  const buckets = bucketByGroup(rest, groupIds)
  const key = targetGroupId !== null && groupIds.includes(targetGroupId) ? targetGroupId : null
  const target = buckets.get(key)!
  const idx = Math.max(0, Math.min(targetIndex, target.length))
  target.splice(idx, 0, { id: connId, groupId: key })

  const out: string[] = []
  for (const gid of groupIds) out.push(...buckets.get(gid)!.map((c) => c.id))
  out.push(...buckets.get(null)!.map((c) => c.id))
  return out
}

/**
 * 세로로 쌓인 요소들 위에서 포인터 y 가 가리키는 삽입 인덱스(0..n) — 각 요소 세로 중심 기준.
 * 그룹 섹션(세로 스택) 순서 변경용. rects 는 "드래그 중인 그룹을 뺀" 목록.
 */
export function verticalInsertionIndex(rects: Array<{ top: number; bottom: number }>, y: number): number {
  for (let i = 0; i < rects.length; i++) {
    if (y < (rects[i].top + rects[i].bottom) / 2) return i
  }
  return rects.length
}

/** id 목록에서 movedId 를 빼고 targetIndex(범위 밖은 클램프)에 다시 끼운 새 순서. */
export function reorderList(ids: string[], movedId: string, targetIndex: number): string[] {
  const rest = ids.filter((id) => id !== movedId)
  const idx = Math.max(0, Math.min(targetIndex, rest.length))
  rest.splice(idx, 0, movedId)
  return rest
}
