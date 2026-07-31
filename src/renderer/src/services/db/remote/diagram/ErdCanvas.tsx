import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useReactFlow,
  getNodesBounds
} from '@xyflow/react'
import type { Connection, Edge, Node, NodeMouseHandler, OnNodeDrag, Viewport, XYPosition } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng, toSvg } from 'html-to-image'
import { Search, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import type { TableDef } from '../../workspaces/definition/types'
import { buildErd } from './graph'
import { OutsideErdNode } from './OutsideErdNode'
import {
  estimateEdgeLabelWidth,
  estimateNodeSize,
  layoutErd,
  mergePositions,
  type Positions
} from './layout'
import { seedNodes } from './seed'
import { matchTables } from './filter'
import { exportFileName, exportViewport, contentBoundsForExport } from './export'
import { TableErdNode } from './TableErdNode'
import { RelationErdEdge } from './RelationErdEdge'
import { GroupErdNode, GROUP_DRAG_HANDLE } from './GroupErdNode'
import {
  collapsedTableIds,
  groupAtPoint,
  groupColor,
  groupNodeId,
  groupOfTable,
  groupRects,
  rewireCollapsedEdges,
  setMembership,
  type DiagramGroup,
  type NodeSizes,
  type Rect
} from './group'

const nodeTypes = { tableErd: TableErdNode, erdGroup: GroupErdNode, outsideErd: OutsideErdNode }
const edgeTypes = { relationErd: RelationErdEdge }

/** 그룹 상자를 테이블·관계선 뒤로 깔기 위한 노드 zIndex(정본 §diagram.group AC-1). */
const GROUP_Z = -1
/** 화면 이동(줌·팬) 저장 지연 — 매 프레임 저장하지 않기 위한 것. 떠날 때는 반드시 마저 저장한다. */
const MOVE_SAVE_DELAY = 800

export interface ErdCanvasProps {
  /** 캔버스에 그릴 테이블(필터 적용 후). */
  tables: TableDef[]
  /** 전체 테이블 id — 필터로 숨은 자리를 지키고, 스키마에서 없어진 것만 정리한다. */
  allTableIds: string[]
  /** 내보내기 파일 이름의 바탕(연결명·설계명). */
  exportName: string
  /** 배치를 바꿀 수 있는가 — 노드·그룹 이동, 그룹 소속 변경. */
  draggable: boolean
  /** 스키마를 고칠 수 있는가 — 모든 컬럼에 관계(FK) 핸들을 열고 드래그 연결을 받는다. */
  editable: boolean
  /** 배치·그룹을 저장할지(커밋 버전 열람 등 읽기 전용이면 false). */
  persist: boolean
  onSaveLayout: (patch: { positions?: Positions; viewport?: Viewport | null }) => void
  onConnectFk?: (c: Connection) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  storedPositions: Positions
  storedViewport: Viewport | null
  groups: DiagramGroup[]
  onGroupsChange: (next: DiagramGroup[]) => void
  /** 툴바에 끼울 추가 조작(관계만 토글·테이블 추가 등). */
  toolbarExtra?: ReactNode
  /**
   * 범위(scope) — 주면 범위 밖 FK 대상을 이름 카드로 그린다(§db-remote.scope R3).
   * 없으면 예전 그대로: 밖을 가리키는 선은 안 그려진다(범위 개념이 없는 설계부 ERD 등).
   */
  scope?: {
    /** 이 연결에서 고를 수 있는 스키마 목록. */
    availableSchemas: string[]
    /** 화면이 이 층을 뭐라 부르나(PostgreSQL "스키마" · MySQL "데이터베이스"). */
    schemaLabel: string
    /** 밖 카드를 눌렀을 때 — 그 스키마를 범위에 더한다. */
    onAddSchema: (schema: string) => void
  }
}

/**
 * ERD 캔버스(공용) — Design › Diagram(가상) · Remote › Diagram(읽기) · Remote › Diagram(편집)
 * 셋이 **이 한 벌**을 쓴다. 정본: `docs/spec/db-remote.md` §db-remote.diagram.
 * 예전에는 셋이 같은 200줄을 복제하고 있어, 배치 버그를 한 곳만 고치고 지나가기 쉬웠다.
 */
export function ErdCanvas({
  tables,
  allTableIds,
  exportName,
  draggable,
  editable,
  persist,
  onSaveLayout,
  onConnectFk,
  selectedId,
  onSelect,
  storedPositions,
  storedViewport,
  groups,
  onGroupsChange,
  toolbarExtra,
  scope
}: ErdCanvasProps) {
  const rf = useReactFlow()
  const [query, setQuery] = useState('')
  const [compact, setCompact] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  /** 지금 테이블을 끄는 중인가 — 그동안 그룹 상자를 얼려 둔다(아래 frozenRectsRef 참고). */
  const [draggingTable, setDraggingTable] = useState(false)

  // 접힌 그룹의 소속은 캔버스에서 뺀다(위치는 저장본에 그대로 남는다 — 펴면 제자리).
  const hidden = useMemo(() => collapsedTableIds(groups), [groups])
  const shown = useMemo(() => tables.filter((t) => !hidden.has(t.id)), [tables, hidden])

  /**
   * 자동 배치용 묶음(노드 id → 그룹 id) — `자동 배치` 가 그룹을 흩어 놓지 않게 dagre 에 넘긴다.
   * ⚠ 소속 목록만 보는 서명으로 memo 한다: 그룹을 끄는 동안 x/y 가 매 프레임 바뀌는데,
   *   그때마다 dagre 를 다시 돌리면 32개 테이블에서 드래그가 눈에 띄게 무거워진다.
   */
  const clusterSig = groups.map((g) => `${g.id}:${g.tableIds.join(',')}`).join('|')
  const clusters = useMemo(() => {
    const out: Record<string, string> = {}
    for (const g of groups) for (const id of g.tableIds) out[id] = g.id
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterSig])

  const base = useMemo(() => toFlow(shown, editable, clusters, scope), [shown, editable, clusters, scope])
  const matched = useMemo(() => matchTables(shown, query), [shown, query])

  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes)
  const seededRef = useRef(false)
  const prevIdsRef = useRef<Set<string>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 지금까지 아는 **모든** 테이블 위치(숨은 것 포함) — 저장은 이 위에 화면 위치를 얹는다. */
  const layoutRef = useRef<Positions>(storedPositions)
  /** 그룹 드래그 중 직전 프레임 위치 — 프레임 간 이동량(dx,dy)을 뽑는다. */
  const groupDragRef = useRef<{ id: string; last: XYPosition } | null>(null)
  /**
   * 테이블을 끄는 동안 얼려 두는 그룹 상자 — 그리기와 소속 판정에 **둘 다** 이걸 쓴다.
   * 실시간으로 다시 재면 상자가 끌려가는 노드를 따라 부풀거나(빠져나갈 수 없음), 그 노드를 빼고
   * 줄어들어(조금만 움직여도 빠짐) 사용자가 본 상자와 결과가 어긋난다(실측 회귀).
   */
  const frozenRectsRef = useRef<Record<string, Rect> | null>(null)
  /** 최신 groups — 드래그 콜백이 낡은 값을 잡지 않게. */
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  useEffect(() => {
    layoutRef.current = { ...storedPositions, ...layoutRef.current }
  }, [storedPositions])

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of base.edges) {
      ;(map.get(e.source) ?? map.set(e.source, new Set()).get(e.source)!).add(e.target)
      ;(map.get(e.target) ?? map.set(e.target, new Set()).get(e.target)!).add(e.source)
    }
    return map
  }, [base.edges])

  /** 노드 실제 크기(측정 전이면 추정) — 그룹 상자 계산의 바탕. */
  const sizes: NodeSizes = useMemo(() => {
    const out: NodeSizes = {}
    for (const t of shown) out[t.id] = estimateNodeSize(t)
    for (const n of nodes) {
      if (n.measured?.width && n.measured?.height) {
        out[n.id] = { width: n.measured.width, height: n.measured.height }
      }
    }
    return out
  }, [shown, nodes])

  const positionsOf = useCallback((ns: Node[]): Positions => {
    const p: Positions = {}
    for (const n of ns) p[n.id] = { x: n.position.x, y: n.position.y }
    return p
  }, [])

  /** 그룹 상자 사각형 — 소속 노드를 여백과 함께 감싼다. */
  const liveRects = useMemo(
    () => groupRects(groups, { ...layoutRef.current, ...positionsOf(nodes) }, sizes),
    [groups, nodes, sizes, positionsOf]
  )
  const rects = draggingTable && frozenRectsRef.current ? frozenRectsRef.current : liveRects
  const liveRectsRef = useRef(liveRects)
  liveRectsRef.current = liveRects

  const groupNodes: Node[] = useMemo(
    () =>
      groups.map((g, i) => {
        const r = rects[g.id]
        return {
          id: groupNodeId(g.id),
          type: 'erdGroup',
          position: { x: r.x, y: r.y },
          width: r.width,
          height: r.height,
          zIndex: GROUP_Z,
          draggable,
          selectable: false,
          deletable: false,
          // 이름표만 잡아서 옮긴다 — 영역 전체가 손잡이면 그 위에서 캔버스를 못 끈다.
          dragHandle: `.${GROUP_DRAG_HANDLE}`,
          data: {
            name: g.name,
            colorKey: groupColor(g, i),
            count: g.tableIds.length,
            collapsed: g.collapsed,
            onToggleCollapse: () =>
              onGroupsChange(groupsRef.current.map((x) => (x.id === g.id ? { ...x, collapsed: !x.collapsed } : x))),
            resizable: draggable,
            sized: g.w != null && g.h != null,
            // 손으로 조절하면 그 순간부터 자리·크기를 사람이 든다(소속을 따라 자동으로 안 변한다).
            onResize: (r: { x: number; y: number; width: number; height: number }) =>
              onGroupsChange(
                groupsRef.current.map((x) =>
                  x.id === g.id ? { ...x, x: r.x, y: r.y, w: r.width, h: r.height } : x
                )
              )
          }
        } satisfies Node
      }),
    [groups, rects, draggable, onGroupsChange]
  )

  /** 접힌 그룹을 드나드는 관계선은 그룹 상자로 끝점을 옮긴다(관계가 사라지면 거짓말). */
  const edges: Edge[] = useMemo(() => {
    const byId = new Map(base.edges.map((e) => [e.id, e]))
    return rewireCollapsedEdges(base.edges, groups).map((r) => {
      const origin = byId.get(r.from[0])!
      if (r.merged === 1 && r.id === origin.id) return origin
      return {
        ...origin,
        id: r.id,
        source: r.source,
        target: r.target,
        sourceHandle: r.source === origin.source ? origin.sourceHandle : undefined,
        label: r.merged > 1 ? `관계 ${r.merged}` : origin.label,
        data: { ...origin.data, selfRef: false, labelShiftY: 0 }
      }
    })
  }, [base.edges, groups])

  const allNodes = useMemo(() => [...groupNodes, ...nodes], [groupNodes, nodes])

  /** 저장(즉시) — 화면 위치를 이미 아는 위치 위에 얹어, 필터로 숨은 테이블 자리를 지킨다. */
  const persistNow = useCallback(() => {
    if (!persist) return
    // 밖 카드 자리도 함께 저장한다 — 안 그러면 옮겨도 새로고침에 제자리로 돌아간다.
    const placeable = rf.getNodes().filter((n) => n.type === 'tableErd' || n.type === 'outsideErd')
    const outsideIds = rf.getNodes().filter((n) => n.type === 'outsideErd').map((n) => n.id)
    const merged = mergePositions(layoutRef.current, positionsOf(placeable), [...allTableIds, ...outsideIds])
    layoutRef.current = merged
    const vp = rf.getViewport()
    onSaveLayout({ positions: merged, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
  }, [persist, rf, allTableIds, onSaveLayout, positionsOf])

  // 스키마/필터 변경 시 재배치. 첫 seed 는 저장된 위치를, 이후엔 현재 화면 위치를 덮어써
  // 사용자가 옮긴 배치를 보존하고 새 테이블만 dagre 자리로 채운다.
  // seed 판정·fitView 는 반드시 updater 밖에서: updater 안에서 ref 를 바꾸면 StrictMode(dev)가
  // updater 를 두 번 불러 첫 seed 분기가 무효화되고, 저장 위치 대신 dagre 배치가 적용·영속된다.
  useEffect(() => {
    const first = !seededRef.current
    seededRef.current = true
    const grew = !first && base.nodes.some((n) => !prevIdsRef.current.has(n.id))
    prevIdsRef.current = new Set(base.nodes.map((n) => n.id))
    setNodes((prev) => seedNodes(base.nodes, prev, first, layoutRef.current))
    if (grew) setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50)
  }, [base, setNodes, rf])

  // 선택/검색/간략 상태 → 노드 data 데코(선택·이웃강조·검색매칭·흐림·간략).
  useEffect(() => {
    const nbrs = selectedId ? (neighbors.get(selectedId) ?? new Set<string>()) : new Set<string>()
    const searching = query.trim().length > 0
    setNodes((prev) =>
      prev.map((n) => {
        const isMatch = matched.has(n.id)
        return {
          ...n,
          data: {
            ...n.data,
            selected: n.id === selectedId,
            highlighted: nbrs.has(n.id),
            matched: isMatch,
            dimmed: searching && !isMatch && n.id !== selectedId,
            compact
          }
        }
      })
    )
  }, [selectedId, neighbors, matched, query, compact, setNodes])

  // ⭐ 떠날 때 마저 저장한다 — 지연 저장을 취소만 하면 마지막 조작이 통째로 날아간다
  //    (회귀: 화면을 옮겼다 오면 배치가 초기화되던 문제, 정본 §diagram.layout AC-2).
  const persistRef = useRef(persistNow)
  persistRef.current = persistNow
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
        persistRef.current()
      }
    }
  }, [])

  const isGroupNode = (id: string): boolean => id.startsWith('grp:')

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      if (isGroupNode(node.id)) return
      onSelect(node.id)
    },
    [onSelect]
  )
  const onPaneClick = useCallback(() => onSelect(null), [onSelect])

  const onNodeDragStart: OnNodeDrag = useCallback((_, node) => {
    if (isGroupNode(node.id)) {
      groupDragRef.current = { id: node.id.slice(4), last: { ...node.position } }
      return
    }
    // 끌기 시작한 순간의 상자를 얼린다 — 사용자가 보고 있는 상자가 곧 놓을 자리다.
    frozenRectsRef.current = liveRectsRef.current
    setDraggingTable(true)
  }, [])

  /** 그룹 이름표를 끄는 동안 소속 테이블을 같은 양만큼 민다(접힌 소속은 저장본에서 민다). */
  const onNodeDrag: OnNodeDrag = useCallback(
    (_, node) => {
      const drag = groupDragRef.current
      if (!drag || !isGroupNode(node.id) || `grp:${drag.id}` !== node.id) return
      const dx = node.position.x - drag.last.x
      const dy = node.position.y - drag.last.y
      if (dx === 0 && dy === 0) return
      drag.last = { ...node.position }
      const target = groupsRef.current.find((g) => g.id === drag.id)
      if (!target) return
      const members = new Set(target.tableIds)
      // ⚠ 캔버스에 있는 소속 판정은 updater **밖**에서 — StrictMode(dev)가 updater 를 두 번 부르므로
      //   updater 안에서 바깥 값을 쌓으면 안 된다(seed.ts 의 같은 함정).
      const onCanvas = new Set(rf.getNodes().filter((n) => members.has(n.id)).map((n) => n.id))
      setNodes((prev) =>
        prev.map((n) => (members.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n))
      )
      // 캔버스에 없는 소속(접힌 그룹 안)은 저장본에서 직접 민다 — 펴면 상대 배치가 그대로.
      // 화면에 있는 소속은 건드리지 않는다(저장할 때 화면 위치가 이기므로 두 번 밀면 어긋난다).
      for (const id of members) {
        if (onCanvas.has(id)) continue
        const p = layoutRef.current[id]
        if (p) layoutRef.current[id] = { x: p.x + dx, y: p.y + dy }
      }
      onGroupsChange(groupsRef.current.map((g) => (g.id === drag.id ? { ...g, x: g.x + dx, y: g.y + dy } : g)))
    },
    [rf, setNodes, onGroupsChange]
  )

  /** 테이블을 놓은 자리로 **소속을 갱신**한다(멤버십이 정본, 위치는 계기일 뿐). */
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, node) => {
      if (isGroupNode(node.id)) {
        groupDragRef.current = null
        persistNow()
        return
      }
      setDraggingTable(false)
      const dropRects = frozenRectsRef.current ?? liveRectsRef.current
      frozenRectsRef.current = null
      if (draggable) {
        const size = sizes[node.id] ?? { width: 232, height: 80 }
        const center = { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 }
        const target = groupAtPoint(groupsRef.current, dropRects, center)
        const current = groupOfTable(groupsRef.current, node.id)?.id ?? null
        if (target !== current) onGroupsChange(setMembership(groupsRef.current, node.id, target))
      }
      persistNow()
    },
    [draggable, sizes, onGroupsChange, persistNow]
  )

  const onMoveEnd = useCallback(() => {
    if (!persist) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      persistNow()
    }, MOVE_SAVE_DELAY)
  }, [persist, persistNow])

  // PNG/SVG 내보내기 — 전체 노드 경계를 담는 뷰포트로 .react-flow__viewport 를 캡처.
  const doExport = useCallback(
    async (format: 'png' | 'svg') => {
      try {
        const ns = rf.getNodes()
        if (!ns.length) return
        const el = document.querySelector('.react-flow__viewport') as HTMLElement | null
        if (!el) return
        const PAD = 48
        // 노드 사각형 + 노드 밖으로 부푸는 관계선(자기참조 루프)까지 감싸 잘림 방지.
        const bounds = contentBoundsForExport(el, getNodesBounds(ns))
        const { width, height, x, y, zoom } = exportViewport(bounds, PAD)
        const opts = {
          backgroundColor: '#ffffff',
          width,
          height,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`
          }
        }
        const dataUrl = format === 'png' ? await toPng(el, opts) : await toSvg(el, opts)
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = exportFileName(exportName, format, new Date())
        // 일부 환경은 DOM 에 붙어 있어야 다운로드가 트리거된다 → 붙였다 제거.
        document.body.appendChild(a)
        a.click()
        a.remove()
        setExportStatus('ok')
      } catch {
        setExportStatus('err')
      }
    },
    [rf, exportName]
  )

  const viewProps = storedViewport ? { defaultViewport: storedViewport } : { fitView: true }

  return (
    <ReactFlow
      nodes={allNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      onConnect={onConnectFk}
      nodesDraggable={draggable}
      nodesConnectable={editable && !!onConnectFk}
      elementsSelectable
      // 그룹 상자를 뒤에 깔려면 선택 시 자동 올림(elevate)을 끈다 — 켜져 있으면
      // 그룹이 선택될 때 z 가 튀어 테이블을 덮는다.
      elevateNodesOnSelect={false}
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={null}
      {...viewProps}
    >
      <Background gap={16} size={1} color="var(--color-line)" />
      <Controls showInteractive={false} position="top-left" />
      <MiniMap zoomable pannable nodeStrokeWidth={3} className="!bg-panel" />
      <Panel position="top-right">
        <div
          data-export-status={exportStatus}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas/95 p-1.5 shadow-sm"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="테이블/컬럼 검색"
              className="selectable h-7 w-40 rounded-md border border-line bg-canvas pl-7 pr-6 text-[12px] text-fg outline-none placeholder:text-muted focus:border-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="검색 지우기"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <ToggleChip active={compact} onClick={() => setCompact((v) => !v)} title="컬럼을 접고 테이블만">
            간략
          </ToggleChip>
          {toolbarExtra}
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => void doExport('png')}>
            PNG
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => void doExport('svg')}>
            SVG
          </Button>
          {exportStatus === 'ok' && <span className="px-0.5 text-[11px] text-success">내보냄 ✓</span>}
          {exportStatus === 'err' && <span className="px-0.5 text-[11px] text-danger">실패</span>}
        </div>
      </Panel>
    </ReactFlow>
  )
}

/** 툴바 토글 칩 — 활성 시 accent 채움(aria-pressed 로 상태 노출). */
export function ToggleChip({
  active,
  onClick,
  title,
  children
}: {
  active: boolean
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        'h-7 rounded-md px-2 text-[12px] font-medium transition-colors',
        active ? 'bg-accent text-white' : 'text-muted hover:bg-panel hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

/** 범위 밖 카드의 고정 크기(px) — `OutsideErdNode` 의 실제 모양과 맞춘다. */
const OUTSIDE_W = 170
const OUTSIDE_H = 52

/** buildErd + dagre 배치 → @xyflow Node/Edge(dagre 좌표). 위치·데코 덮어쓰기는 effect 가 한다. */
function toFlow(
  tables: TableDef[],
  editable: boolean,
  clusters: Record<string, string>,
  scope?: ErdCanvasProps['scope']
): { nodes: Node[]; edges: Edge[] } {
  const erd = buildErd(tables, scope?.availableSchemas)
  const positions = layoutErd(
    [
      ...erd.nodes.map((n) => ({ id: n.id, ...estimateNodeSize(n.table) })),
      // 밖 카드는 컬럼이 없어 크기가 고정이다 — 실물 노드와 같은 배치 계산에 함께 넣어야
      // 선이 겹치지 않는다.
      ...erd.outsideNodes.map((n) => ({ id: n.id, width: OUTSIDE_W, height: OUTSIDE_H }))
    ],
    erd.edges.map((e) => ({ source: e.source, target: e.target, labelWidth: estimateEdgeLabelWidth(e) })),
    { clusters }
  )
  const nodes: Node[] = erd.nodes.map((n) => ({
    id: n.id,
    type: 'tableErd',
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: {
      table: n.table,
      selected: false,
      highlighted: false,
      matched: false,
      dimmed: false,
      compact: false,
      // 뷰 노드는 관계 핸들을 열지 않는다 — FK 를 걸 수 없는 대상에 연결점을 보이면 거짓말이다.
      editable: editable && !n.table.isView
    }
  }))
  for (const n of erd.outsideNodes) {
    nodes.push({
      id: n.id,
      type: 'outsideErd',
      position: positions[n.id] ?? { x: 0, y: 0 },
      // 끌어 옮길 수 있고 자리도 저장된다(2026-07-30 사용자 제보 — 못 옮기는 이유가 없다).
      // 다만 **고를 수는 없다**: 상세 서랍에 보일 컬럼이 없어, 고르면 빈 서랍이 열린다.
      selectable: false,
      data: {
        target: n.target,
        kind: n.kind,
        schemaLabel: scope?.schemaLabel ?? '스키마',
        onAdd: scope?.onAddSchema
      }
    })
  }
  const edges: Edge[] = erd.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceColumnId || undefined,
    type: 'relationErd',
    label: e.label,
    data: {
      nullable: e.nullable,
      isUnique: e.isUnique,
      onDelete: e.onDelete,
      onUpdate: e.onUpdate,
      selfRef: e.selfRef,
      labelShiftY: e.labelShiftY
    }
  }))
  return { nodes, edges }
}
