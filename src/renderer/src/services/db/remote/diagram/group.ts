import type { Positions } from './layout'

/**
 * 다이어그램 그룹(레이어)의 순수 계산 — 세 ERD 캔버스(Design 가상 · Remote 읽기 · Remote 편집)
 * 공용. 정본: `docs/spec/db-remote.md` §db-remote.diagram.group.
 *
 * 핵심 결정: **소속은 명시 멤버십으로 든다.** 노드 좌표가 어느 영역 안인지로 소속을 "추정"하면
 * `자동 배치` 한 번에 묶음이 통째로 흩어진다. 영역 안으로 끌어다 놓는 동작은 멤버십을 **갱신**할 뿐,
 * 소속의 근거가 아니다.
 *
 * 입력→출력이 결정적이라 테스트 의무 대상(`group.test.ts`).
 */

export interface DiagramGroup {
  id: string
  name: string
  /** 팔레트 키. 빈 문자열이면 목록 순서대로 자동 배정한다. */
  color: string
  /** 소속 테이블 id. 한 테이블은 최대 한 그룹에만 든다. */
  tableIds: string[]
  collapsed: boolean
  /** 상자 기준점(절대 좌표) — 빈 그룹·접힌 그룹의 자리이자 펼친 그룹 좌상단의 캐시. */
  x: number
  y: number
  /**
   * 손으로 정한 상자 크기. 있으면 **소속을 따라 자동으로 늘거나 줄지 않는다**
   * (사람이 정한 크기를 앱이 되돌리면 조절이 무의미하다). 없으면 소속을 감싸 자동 계산.
   * 자동으로 되돌리려면 이 값을 지운다(패널의 `자동 크기`).
   */
  w?: number
  h?: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type NodeSizes = Record<string, { width: number; height: number }>

/** 소속 상자와 그룹 테두리 사이 여백. */
export const GROUP_PAD = 28
/** 이름표 높이 — 위쪽 여백에 더 얹어 이름이 테이블을 덮지 않게 한다. */
export const GROUP_HEADER_H = 26
/** 빈 그룹 최소 크기 — 끌어다 놓을 자리가 없으면 그룹을 만들 수가 없다. */
export const GROUP_MIN_W = 280
export const GROUP_MIN_H = 180
/** 접힌 그룹 상자 크기(이름표 한 장 크기). */
export const GROUP_COLLAPSED_W = 240
export const GROUP_COLLAPSED_H = 72
/** 크기를 모르는 노드의 대체 크기(측정 전 한 프레임). */
const FALLBACK_NODE = { width: 232, height: 80 }

/** 화이트 테마 위에서 안의 테이블 글자를 읽을 수 있는 옅은 채움만 쓴다(시각 규칙은 GroupErdNode). */
export const GROUP_PALETTE = ['sky', 'violet', 'amber', 'emerald', 'rose', 'slate'] as const
export type GroupColorKey = (typeof GROUP_PALETTE)[number]

/** 고른 색이 있으면 그대로, 없으면 목록 순서대로 팔레트를 돌려 쓴다. */
export function groupColor(group: Pick<DiagramGroup, 'color'>, index: number): GroupColorKey {
  const picked = GROUP_PALETTE.find((c) => c === group.color)
  return picked ?? GROUP_PALETTE[((index % GROUP_PALETTE.length) + GROUP_PALETTE.length) % GROUP_PALETTE.length]
}

/** 겹치지 않는 다음 그룹 id — 무작위 대신 순번이라 테스트가 결정적이다. */
export function nextGroupId(groups: DiagramGroup[]): string {
  let max = 0
  for (const g of groups) {
    const m = /^g(\d+)$/.exec(g.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `g${max + 1}`
}

/**
 * 새 그룹 상자를 놓을 자리 — **기존 내용의 오른쪽 빈 자리**에, 이미 있는 그룹 수만큼 아래로 어긋나게.
 * 화면 중앙에 놓으면 지금 보이는 테이블 위를 덮어 무엇이 생겼는지 안 보이고,
 * 고정 좌표에 놓으면 그룹을 여러 개 만들 때 서로 겹친다.
 */
export function nextGroupAnchor(positions: Positions, groups: DiagramGroup[]): { x: number; y: number } {
  const pts = Object.values(positions)
  if (pts.length === 0) return { x: 40, y: 40 + groups.length * 40 }
  const maxX = pts.reduce((m, p) => Math.max(m, p.x), -Infinity)
  const minY = pts.reduce((m, p) => Math.min(m, p.y), Infinity)
  return { x: Math.round(maxX + 320), y: Math.round(minY + groups.length * 40) }
}

/**
 * 그룹을 지울 때 **소속 테이블까지 함께 지우려면** 사람이 그대로 입력해야 하는 문구(설계부 전용).
 * 버튼 한 번으로 테이블 여러 개가 사라지면 안 되니, 몇 개가 사라지는지를 손으로 쓰게 한다.
 */
export function groupDeletePhrase(tableCount: number): string {
  return `${tableCount}개 테이블도 함께 삭제합니다`
}

/** 입력이 문구와 맞나 — 앞뒤 공백만 눈감아 준다(가운데 공백까지 풀어 주면 확인의 뜻이 없다). */
export function matchesGroupDeletePhrase(input: string, tableCount: number): boolean {
  return input.trim() === groupDeletePhrase(tableCount)
}

/** 그 테이블이 든 그룹(없으면 null). */
export function groupOfTable(groups: DiagramGroup[], tableId: string): DiagramGroup | null {
  return groups.find((g) => g.tableIds.includes(tableId)) ?? null
}

/**
 * 테이블의 소속을 바꾼 새 목록. `groupId: null` 이면 어디에도 안 속하게 한다.
 * 한 테이블은 최대 한 그룹이므로 다른 그룹에서는 반드시 뺀다(중복 소속 금지).
 */
export function setMembership(groups: DiagramGroup[], tableId: string, groupId: string | null): DiagramGroup[] {
  return groups.map((g) => {
    const has = g.tableIds.includes(tableId)
    if (g.id === groupId) return has ? g : { ...g, tableIds: [...g.tableIds, tableId] }
    return has ? { ...g, tableIds: g.tableIds.filter((id) => id !== tableId) } : g
  })
}

/** 접힌 그룹에 속해 캔버스에서 숨는 테이블 id 들. */
export function collapsedTableIds(groups: DiagramGroup[]): Set<string> {
  const out = new Set<string>()
  for (const g of groups) if (g.collapsed) for (const id of g.tableIds) out.add(id)
  return out
}

/**
 * 그룹 영역 사각형. 우선순위는 **접힘 → 손으로 정한 크기 → 소속 자동 감싸기** 순이고,
 * 그릴 소속이 없으면 기준점에 최소 크기 상자를 둔다(끌어다 놓을 자리 유지).
 */
export function groupRect(group: DiagramGroup, positions: Positions, sizes: NodeSizes): Rect {
  if (group.collapsed) {
    return { x: group.x, y: group.y, width: GROUP_COLLAPSED_W, height: GROUP_COLLAPSED_H }
  }
  // 손으로 정한 크기가 이긴다 — 소속을 옮겨도 상자는 사람이 둔 그대로.
  if (group.w != null && group.h != null) {
    return {
      x: group.x,
      y: group.y,
      width: Math.max(GROUP_MIN_W, group.w),
      height: Math.max(GROUP_MIN_H, group.h)
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of group.tableIds) {
    const p = positions[id]
    if (!p) continue
    const s = sizes[id] ?? FALLBACK_NODE
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + s.width)
    maxY = Math.max(maxY, p.y + s.height)
  }
  if (minX === Infinity) {
    return { x: group.x, y: group.y, width: GROUP_MIN_W, height: GROUP_MIN_H }
  }
  const x = minX - GROUP_PAD
  const y = minY - GROUP_PAD - GROUP_HEADER_H
  return {
    x,
    y,
    width: Math.max(GROUP_MIN_W, maxX - minX + GROUP_PAD * 2),
    height: Math.max(GROUP_MIN_H, maxY - minY + GROUP_PAD * 2 + GROUP_HEADER_H)
  }
}

/** 모든 그룹의 영역을 한 번에(id → 사각형). */
export function groupRects(
  groups: DiagramGroup[],
  positions: Positions,
  sizes: NodeSizes
): Record<string, Rect> {
  const out: Record<string, Rect> = {}
  for (const g of groups) out[g.id] = groupRect(g, positions, sizes)
  return out
}

/**
 * 놓은 점이 어느 그룹 안인지. 영역이 겹치면 **더 좁은(안쪽) 그룹**을 고른다 —
 * 큰 그룹이 작은 그룹을 품고 있을 때 큰 쪽이 이기면 안쪽 그룹에 넣을 방법이 없어진다.
 *
 * ⚠ 넘기는 `rects` 는 **드래그를 시작한 순간의 사각형**이어야 한다. 끄는 중의 실시간 사각형을
 * 쓰면, 상자가 끌려가는 노드를 따라 부풀거나(안 빠짐) 그 노드를 빼고 줄어들어(조금만 움직여도
 * 빠짐) 어느 쪽이든 사용자가 본 상자와 판정이 어긋난다. ErdCanvas 가 시작 시점 값을 얼려 넘긴다.
 */
export function groupAtPoint(
  groups: DiagramGroup[],
  rects: Record<string, Rect>,
  point: { x: number; y: number }
): string | null {
  let best: string | null = null
  let bestArea = Infinity
  for (const g of groups) {
    const r = rects[g.id]
    if (!r) continue
    if (point.x < r.x || point.x > r.x + r.width || point.y < r.y || point.y > r.y + r.height) continue
    const area = r.width * r.height
    if (area < bestArea) {
      best = g.id
      bestArea = area
    }
  }
  return best
}

/**
 * 그룹을 (dx,dy) 옮긴 결과 — 기준점과 **소속 노드 위치**를 같은 양만큼 민다.
 * 접힌 그룹도 숨은 소속을 함께 민다(펴면 상대 배치가 그대로 유지되도록).
 */
export function moveGroup(
  groups: DiagramGroup[],
  positions: Positions,
  groupId: string,
  dx: number,
  dy: number
): { groups: DiagramGroup[]; positions: Positions } {
  const target = groups.find((g) => g.id === groupId)
  if (!target || (dx === 0 && dy === 0)) return { groups, positions }
  const members = new Set(target.tableIds)
  const nextPositions: Positions = { ...positions }
  for (const id of members) {
    const p = nextPositions[id]
    if (p) nextPositions[id] = { x: p.x + dx, y: p.y + dy }
  }
  return {
    groups: groups.map((g) => (g.id === groupId ? { ...g, x: g.x + dx, y: g.y + dy } : g)),
    positions: nextPositions
  }
}

/**
 * 캔버스에 남길 테이블 — `관계만`(고립 숨김)과 `그룹만 보기`를 **함께** 건다(교집합).
 * 켠 그룹이 하나도 없으면 그룹 필터는 통과시킨다(아무것도 안 고른 상태 = 전체 보기).
 */
export function visibleTables<T extends { id: string }>(
  tables: T[],
  opts: {
    isolated?: Set<string>
    hideIsolated?: boolean
    groups?: DiagramGroup[]
    onlyGroups?: Set<string>
  }
): T[] {
  const { isolated, hideIsolated, groups = [], onlyGroups } = opts
  const groupFilterOn = !!onlyGroups && onlyGroups.size > 0
  const allowed = new Set<string>()
  if (groupFilterOn) {
    for (const g of groups) if (onlyGroups!.has(g.id)) for (const id of g.tableIds) allowed.add(id)
  }
  return tables.filter((t) => {
    if (hideIsolated && isolated?.has(t.id)) return false
    if (groupFilterOn && !allowed.has(t.id)) return false
    return true
  })
}

/** 접힌 그룹 때문에 끝점이 그룹 상자로 옮겨간 관계선. */
export interface RewiredEdge {
  /** 원래 엣지 id, 또는 합쳐진 경우 `grp:<source>::<target>`. */
  id: string
  source: string
  target: string
  /** 합쳐진 관계 수(1 이면 원래 그대로). */
  merged: number
  /** 이 선이 대표하는 원래 엣지 id 들. */
  from: string[]
}

/** 그룹 상자를 가리키는 노드 id — 테이블 id(`t:`)와 겹치지 않게 접두어를 둔다. */
export const groupNodeId = (groupId: string): string => `grp:${groupId}`

/**
 * 접힌 그룹의 관계선 정리 — 관계가 조용히 사라지면 안 된다(정본 AC-4).
 * - 양끝이 **같은** 접힌 그룹 안 → 감춘다(그룹 안에서만 벌어지는 일).
 * - 한쪽/양쪽 끝이 접힌 그룹 안 → 그 끝을 그룹 상자로 옮겨 남긴다.
 * - 같은 끝점 쌍으로 여러 관계가 몰리면 하나로 합친다(선이 겹쳐 두꺼워 보이지 않게).
 */
export function rewireCollapsedEdges<E extends { id: string; source: string; target: string }>(
  edges: E[],
  groups: DiagramGroup[]
): RewiredEdge[] {
  const boxOf = new Map<string, string>()
  for (const g of groups) if (g.collapsed) for (const id of g.tableIds) boxOf.set(id, g.id)

  const out: RewiredEdge[] = []
  const byPair = new Map<string, RewiredEdge>()
  for (const e of edges) {
    const sg = boxOf.get(e.source)
    const tg = boxOf.get(e.target)
    if (sg && tg && sg === tg) continue // 그룹 안↔안 — 접힌 상자 안에서 벌어지는 일
    if (!sg && !tg) {
      out.push({ id: e.id, source: e.source, target: e.target, merged: 1, from: [e.id] })
      continue
    }
    const source = sg ? groupNodeId(sg) : e.source
    const target = tg ? groupNodeId(tg) : e.target
    const key = `${source}::${target}`
    const seen = byPair.get(key)
    if (seen) {
      seen.merged += 1
      seen.from.push(e.id)
      continue
    }
    const rewired: RewiredEdge = { id: `grp:${key}`, source, target, merged: 1, from: [e.id] }
    byPair.set(key, rewired)
    out.push(rewired)
  }
  return out
}
