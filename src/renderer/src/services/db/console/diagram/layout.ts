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
}

export interface LayoutOptions {
  /** 배치 방향 — 기본 LR(좌→우, ERD 관례). */
  direction?: 'LR' | 'TB'
  /** 랭크(계층) 간격. */
  ranksep?: number
  /** 같은 랭크 노드 간격. */
  nodesep?: number
}

export type Positions = Record<string, { x: number; y: number }>

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

export function layoutErd(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions = {}
): Positions {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: opts.direction ?? 'LR',
    ranksep: opts.ranksep ?? 120,
    nodesep: opts.nodesep ?? 60,
    marginx: 20,
    marginy: 20
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
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
