import dagre from '@dagrejs/dagre'
import type { TableDef } from '../../workspaces/definition/types'

/**
 * ERD 자동 배치(§ops-plan 2e) — dagre 로 노드 좌표를 결정적으로 계산하는 순수 함수.
 * dagre 는 노드 **중심** 좌표를 주므로 여기서 좌상단(top-left)으로 변환해
 * @xyflow 의 position(좌상단 기준)에 바로 쓰도록 돌려준다. 입력→출력 결정적 → 테스트 의무.
 */

export interface LayoutNode {
  id: string
  width: number
  height: number
}

export interface LayoutEdge {
  source: string
  target: string
  /** 이 관계선 라벨의 추정 폭(px) — 랭크 간격이 라벨을 품도록. `estimateEdgeLabelWidth` 참고. */
  labelWidth?: number
}

export interface LayoutOptions {
  /** 배치 방향 — 기본 LR(좌→우, ERD 관례). */
  direction?: 'LR' | 'TB'
  /** 랭크(계층) 간격. */
  ranksep?: number
  /** 같은 랭크 노드 간격. */
  nodesep?: number
  /**
   * 노드 id → 묶음 id. 주면 **같은 묶음끼리 붙여** 배치한다(dagre 의 compound graph).
   * 다이어그램 그룹을 그대로 넘기면 `자동 배치` 가 그룹을 흩어 놓지 않는다.
   * 안 주면 예전과 완전히 같은 배치가 나온다.
   */
  clusters?: Record<string, string>
}

export type Positions = Record<string, { x: number; y: number }>

/**
 * 배치 저장용 위치 병합(순수) — 지금 화면에 있는 노드의 위치를 **이미 저장된 위치 위에 얹는다**.
 * 통째로 덮어쓰면 필터(`관계만`·`그룹만 보기`)로 숨어 있던 테이블의 자리가 지워진다(회귀 — 정본
 * §db-remote.diagram.layout AC-3). 정리는 **스키마에서 없어진 테이블**만 한다.
 * `known` 이 비면(스키마를 아직 못 읽음) 아무것도 지우지 않는다 — 모른다는 것을 "없다"로 읽지 않는다.
 */
export function mergePositions(stored: Positions, visible: Positions, known: Iterable<string>): Positions {
  const knownSet = new Set(known)
  const out: Positions = {}
  for (const [id, p] of Object.entries(stored)) {
    if (knownSet.size > 0 && !knownSet.has(id)) continue
    out[id] = p
  }
  for (const [id, p] of Object.entries(visible)) out[id] = p
  return out
}

/**
 * 노드 크기 추정 — 헤더 + 컬럼 행 높이/폭. 배치 겹침을 줄이려 실제 렌더 크기에 근사.
 * 폭을 상수로 두면 긴 타입 문자열(예: 긴 ENUM) 테이블이 실제보다 좁게 추정돼 dagre 가
 * 이웃과 겹치게 배치한다 → 폭은 헤더/가장 긴 컬럼 행의 내용 길이에서 뽑는다.
 * 모노 폰트 기준 문자폭은 대략 fontSize*0.6 (헤더 13px·이름 11px·타입 10px). TableErdNode 레이아웃과 맞춘 여백/배지 상수.
 */
export function estimateNodeSize(table: TableDef): { width: number; height: number } {
  const HEADER = 34
  const ROW = 22
  const MIN_WIDTH = 232
  const PAD_X = 20 // px-2.5 좌우 합
  const BADGE = 48 // 키 배지 열(w-10) + 여유(FK IDX 등 복수 배지)
  const GAPS = 12 // 배지↔이름, 이름↔타입 gap-1.5 두 개
  const CH_HEADER = 8 // 13px semibold mono
  const CH_NAME = 7 // 11px mono
  const CH_TYPE = 6 // 10px mono

  const headerWidth = PAD_X + table.name.length * CH_HEADER + 16 // 16: VIEW 배지 등 여유
  const rowWidth = (c: { name: string; type: string }) =>
    PAD_X + BADGE + GAPS + c.name.length * CH_NAME + c.type.length * CH_TYPE
  const widestRow = table.columns.reduce((max, c) => Math.max(max, rowWidth(c)), 0)

  const width = Math.ceil(Math.max(MIN_WIDTH, headerWidth, widestRow))
  const height = HEADER + Math.max(1, table.columns.length) * ROW + 8
  return { width, height }
}

/** 라벨 앵커 오프셋(소스 핸들에서 오른쪽으로) — RelationErdEdge 의 26px 과 맞춘다. */
const LABEL_ANCHOR = 26
/** 라벨 끝과 참조 테이블 사이 최소 숨 쉴 틈. */
const LABEL_TAIL = 14
/** 기본 랭크 간격 — 라벨이 짧아도 이만큼은 벌린다. */
const BASE_RANKSEP = 180
/** 라벨이 병적으로 길어도 캔버스가 가로로 터지지 않게 상한(넘치면 뷰가 라벨을 줄인다). */
const MAX_RANKSEP = 520

/**
 * 관계선 라벨 폭 추정(px) — RelationErdEdge 의 **카드형 라벨** 마크업 기준.
 * 카드는 두 줄이다: 1줄 `col → refCol`(10px mono), 2줄 `D:정책 U:정책`(9px).
 * → 필요한 폭은 두 줄의 **합이 아니라 최대치** (한 줄로 늘어놓던 옛 버전보다 좁다 = 랭크가 덜 벌어진다).
 * 자기참조는 노드 위 루프에 얹히므로 랭크 간격과 무관 → 0.
 */
export function estimateEdgeLabelWidth(e: {
  label?: string
  onDelete?: string
  onUpdate?: string
  selfRef?: boolean
}): number {
  if (e.selfRef) return 0
  const BOX = 18 // px-2 좌우(16) + border(2)
  const GAP = 8 // 정책 두 배지 사이 gap-2
  const CH_LABEL = 6.4 // 10px mono
  const CH_POLICY = 5.5 // 9px
  const line1 = (e.label?.length ?? 0) * CH_LABEL
  const policies: number[] = []
  if (e.onDelete) policies.push((e.onDelete.length + 2) * CH_POLICY) // "D:" 접두
  if (e.onUpdate) policies.push((e.onUpdate.length + 2) * CH_POLICY)
  const line2 = policies.reduce((a, b) => a + b, 0) + GAP * Math.max(0, policies.length - 1)
  const inner = Math.max(line1, line2)
  if (inner <= 0) return 0
  return Math.ceil(BOX + inner)
}

export function layoutErd(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions = {}
): Positions {
  // 가로 계층 간격 — 관계선 라벨(예: "user_id → id  D:RESTRICT U:CASCADE")이 통째로 낄 자리를 둔다.
  // 라벨은 소스 노드 오른쪽(랭크 사이 빈칸)에 붙으므로, 간격이 라벨보다 좁으면 참조 테이블 아래로
  // 깔려 잘려 보인다(회귀) → 가장 긴 라벨을 기준으로 벌린다.
  const widestLabel = edges.reduce((max, e) => Math.max(max, e.labelWidth ?? 0), 0)
  const labelRanksep = widestLabel > 0 ? widestLabel + LABEL_ANCHOR + LABEL_TAIL : 0
  const ranksep = Math.min(MAX_RANKSEP, Math.max(opts.ranksep ?? BASE_RANKSEP, labelRanksep))

  // compound: true 는 묶음(setParent)을 쓸 때만 필요하다. 없을 때도 켜 두면 배치가 달라질 수 있어
  // 묶음이 실제로 있을 때만 켠다(그룹 없는 다이어그램의 배치를 건드리지 않기 위해).
  const clusters = opts.clusters ?? {}
  const clusterIds = [...new Set(Object.values(clusters))]
  const g = new dagre.graphlib.Graph({ compound: clusterIds.length > 0 })
  g.setGraph({
    rankdir: opts.direction ?? 'LR',
    ranksep,
    // 세로 노드 간격 — 이웃 테이블끼리, 그리고 노드 위로 부푸는 자기참조 루프가 겹치지 않게 넉넉히.
    nodesep: opts.nodesep ?? 100,
    marginx: 20,
    marginy: 20
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  // 묶음 노드를 먼저 만들고 소속을 붙인다 — 없는 부모에 붙이면 dagre 가 던진다.
  for (const cid of clusterIds) g.setNode(`cluster:${cid}`, {})
  for (const [nodeId, cid] of Object.entries(clusters)) {
    if (g.hasNode(nodeId)) g.setParent(nodeId, `cluster:${cid}`)
  }
  // 자기참조 엣지는 랭크에 영향이 없고 dagre 를 흔드므로 배치 그래프에서 제외.
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  const positions: Positions = {}
  for (const n of nodes) {
    const dn = g.node(n.id)
    // dagre 는 중심 좌표 → 좌상단으로 변환.
    positions[n.id] = { x: dn.x - n.width / 2, y: dn.y - n.height / 2 }
  }
  return positions
}
