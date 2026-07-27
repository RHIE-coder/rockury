import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds
} from '@xyflow/react'
import type { Node, Edge, NodeMouseHandler, Viewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng, toSvg } from 'html-to-image'
import { Network, Loader2, Pencil, RefreshCw, LayoutGrid, Search, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import type { TableDef } from '../workspaces/definition/types'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { buildErd } from './diagram/graph'
import { estimateEdgeLabelWidth, estimateNodeSize, layoutErd, type Positions } from './diagram/layout'
import { seedNodes } from './diagram/seed'
import { isolatedTableIds, matchTables } from './diagram/filter'
import { exportFileName, exportViewport, contentBoundsForExport } from './diagram/export'
import { TableErdNode } from './diagram/TableErdNode'
import { RelationErdEdge } from './diagram/RelationErdEdge'
import { DiagramTablePanel } from './diagram/DiagramTablePanel'
import { useSchemaEditStore } from './schemaEdit/store'
import { DiagramEdit } from './schemaEdit/DiagramEdit'

const nodeTypes = { tableErd: TableErdNode }
const edgeTypes = { relationErd: RelationErdEdge }

/** buildErd + dagre 배치 → @xyflow Node/Edge(dagre 좌표). 위치·데코 덮어쓰기는 effect 가 한다. */
function toFlow(tables: TableDef[]): { nodes: Node[]; edges: Edge[] } {
  const erd = buildErd(tables)
  const positions = layoutErd(
    erd.nodes.map((n) => ({ id: n.id, ...estimateNodeSize(n.table) })),
    erd.edges.map((e) => ({ source: e.source, target: e.target, labelWidth: estimateEdgeLabelWidth(e) }))
  )
  const nodes: Node[] = erd.nodes.map((n) => ({
    id: n.id,
    type: 'tableErd',
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { table: n.table, selected: false, highlighted: false, matched: false, dimmed: false, compact: false }
  }))
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

interface CanvasProps {
  /** 이미 필터가 적용된, 캔버스에 그릴 테이블들. */
  tables: TableDef[]
  connectionId: string
  connName: string
  storedPositions: Positions
  storedViewport: Viewport | null
  /** 선택 상태는 좌측 목록 패널과 공유하므로 부모가 든다. */
  selected: string | null
  onSelect: (id: string | null) => void
  hideIsolated: boolean
  onToggleIsolated: () => void
}

function DiagramCanvas({
  tables: visibleTables,
  connectionId,
  connName,
  storedPositions,
  storedViewport,
  selected,
  onSelect,
  hideIsolated,
  onToggleIsolated
}: CanvasProps) {
  const rf = useReactFlow()
  const [query, setQuery] = useState('')
  const [compact, setCompact] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'ok' | 'err'>('idle')

  const base = useMemo(() => toFlow(visibleTables), [visibleTables])
  const matched = useMemo(() => matchTables(visibleTables, query), [visibleTables, query])

  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges)
  const seededRef = useRef(false)
  // 직전 effect 실행 시점의 노드 id 집합 — grew(새 테이블 등장) 판정을 updater 밖에서 하기 위함.
  const prevIdsRef = useRef<Set<string>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 선택 테이블과 직접 연결된 이웃(강조).
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of base.edges) {
      ;(map.get(e.source) ?? map.set(e.source, new Set()).get(e.source)!).add(e.target)
      ;(map.get(e.target) ?? map.set(e.target, new Set()).get(e.target)!).add(e.source)
    }
    return map
  }, [base.edges])

  // 위치를 저장(연결별). 드래그/이동 후 호출 — 현재 화면 좌표+뷰포트를 그대로 영속.
  const persist = useCallback(() => {
    const positions: Positions = {}
    for (const n of rf.getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y }
    const vp = rf.getViewport()
    void window.rockury.diagram
      .saveLayout({ connectionId, positions, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
      .catch(() => {})
  }, [rf, connectionId])

  // 스키마/필터 변경 시 재배치. 첫 seed 는 저장된 위치를, 이후엔 현재 화면 위치를 덮어써
  // 사용자가 옮긴 배치를 보존하고 새 테이블만 dagre 자리로 채운다.
  // seed 판정·fitView 는 반드시 updater 밖에서: updater 안에서 ref 를 바꾸면 StrictMode(dev)가
  // updater 를 두 번 불러 첫 seed 분기가 무효화되고, 저장 위치 대신 dagre 배치가 적용·영속된다.
  useEffect(() => {
    const first = !seededRef.current
    seededRef.current = true
    const grew = !first && base.nodes.some((n) => !prevIdsRef.current.has(n.id))
    prevIdsRef.current = new Set(base.nodes.map((n) => n.id))
    setNodes((prev) => seedNodes(base.nodes, prev, first, storedPositions))
    setEdges(base.edges)
    if (grew) setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50)
  }, [base, storedPositions, setNodes, setEdges, rf])

  // 선택/검색/간략 상태 → 노드 data 데코(선택·이웃강조·검색매칭·흐림·간략).
  useEffect(() => {
    const nbrs = selected ? (neighbors.get(selected) ?? new Set<string>()) : new Set<string>()
    const searching = matched.size > 0 || query.trim().length > 0
    setNodes((prev) =>
      prev.map((n) => {
        const isMatch = matched.has(n.id)
        return {
          ...n,
          data: {
            ...n.data,
            selected: n.id === selected,
            highlighted: nbrs.has(n.id),
            matched: isMatch,
            dimmed: searching && !isMatch && n.id !== selected,
            compact
          }
        }
      })
    )
  }, [selected, neighbors, matched, query, compact, setNodes])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => onSelect(node.id), [onSelect])
  const onPaneClick = useCallback(() => onSelect(null), [onSelect])
  const onNodeDragStop = useCallback(() => persist(), [persist])
  const onMoveEnd = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 800)
  }, [persist])

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
        a.download = exportFileName(connName, format, new Date())
        // 일부 환경은 DOM 에 붙어 있어야 다운로드가 트리거된다 → 붙였다 제거.
        document.body.appendChild(a)
        a.click()
        a.remove()
        setExportStatus('ok')
      } catch {
        setExportStatus('err')
      }
    },
    [rf, connName]
  )

  const viewProps = storedViewport ? { defaultViewport: storedViewport } : { fitView: true }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      nodesConnectable={false}
      elementsSelectable
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
          <ToggleChip active={hideIsolated} onClick={onToggleIsolated} title="관계 없는 테이블 숨김">
            관계만
          </ToggleChip>
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
function ToggleChip({
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

/**
 * Console › Diagram(운영부 · depth 3, §ops-plan 2e) — 실 DB 를 역설계(introspection)한 ERD.
 * Object 뷰와 같은 `TableDef[]`(useConsoleStore)를 소비하되 그래프로 렌더.
 * v2: 노드 위치·뷰포트를 연결별로 영속. 마감: 검색·간략/관계만 필터·PNG/SVG 내보내기.
 */
export function DiagramView() {
  const conn = useActiveConnection()
  const connId = conn?.id ?? null

  const tables = useConsoleStore((s) => (connId ? s.byEnv[connId] : undefined))
  const loading = useConsoleStore((s) => (connId ? s.loading[connId] : false))
  const error = useConsoleStore((s) => (connId ? s.error[connId] : null))
  const load = useConsoleStore((s) => s.load)

  const editing = useSchemaEditStore((s) => s.editing)
  const editConnId = useSchemaEditStore((s) => s.connId)
  const begin = useSchemaEditStore((s) => s.begin)

  const [storedPositions, setStoredPositions] = useState<Positions>({})
  const [storedViewport, setStoredViewport] = useState<Viewport | null>(null)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)
  // 선택·"관계만" 필터는 좌측 목록 패널과 캔버스가 같은 값을 봐야 해 여기서 든다
  // (패널에 캔버스에 없는 테이블이 뜨면 눌러도 이동할 곳이 없다).
  const [selected, setSelected] = useState<string | null>(null)
  const [hideIsolated, setHideIsolated] = useState(false)

  useEffect(() => {
    if (connId) void load(connId, connId)
  }, [connId, load])

  useEffect(() => {
    if (!connId) return
    let alive = true
    setLayoutLoaded(false)
    void window.rockury.diagram
      .getLayout(connId)
      .then((l) => {
        if (!alive) return
        setStoredPositions(l?.positions ?? {})
        setStoredViewport(l?.viewport ?? null)
        setLayoutLoaded(true)
      })
      .catch(() => alive && setLayoutLoaded(true))
    return () => {
      alive = false
    }
  }, [connId, nonce])

  const edgeCount = useMemo(() => (tables ? buildErd(tables).edges.length : 0), [tables])

  // 관계 없는 고립 테이블 — "관계만" 토글이 목록·캔버스에서 함께 숨긴다.
  const isolated = useMemo(() => (tables ? isolatedTableIds(buildErd(tables)) : new Set<string>()), [tables])
  const visibleTables = useMemo(
    () => (hideIsolated ? (tables ?? []).filter((t) => !isolated.has(t.id)) : (tables ?? [])),
    [tables, hideIsolated, isolated]
  )

  const resetLayout = useCallback(async () => {
    if (!connId) return
    await window.rockury.diagram.clearLayout(connId).catch(() => {})
    setStoredPositions({})
    setStoredViewport(null)
    setNonce((x) => x + 1)
  }, [connId])

  if (!conn) {
    return (
      <PlaceholderView
        icon={Network}
        depth="depth 3 · Console › Diagram"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 실 DB 를 역설계해 ERD 로 그립니다."
      />
    )
  }

  const ready = tables && tables.length > 0 && layoutLoaded
  const isEditing = editing && editConnId === conn.id

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Diagram <span className="font-normal text-muted">· {conn.name}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {isEditing
              ? '편집 중 — 관계는 컬럼 점을 끌어 연결, 변경은 아래에서 적용'
              : loading
                ? '실 DB 역설계 중…'
                : tables
                  ? `${tables.length}개 테이블 · 관계 ${edgeCount} · Reverse(introspection) ERD`
                  : '역설계 대기'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">편집 중</span>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={loading || !tables} onClick={() => void resetLayout()}>
                <LayoutGrid /> 자동 배치
              </Button>
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(conn.id, conn.id, true)}>
                {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 새로고침
              </Button>
              <Button size="sm" disabled={loading || !tables} onClick={() => begin(conn.id, tables ?? [])}>
                <Pencil /> 편집
              </Button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <DiagramEdit conn={conn} />
      ) : error ? (
        <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          역설계 실패: {error}
        </div>
      ) : (loading || !layoutLoaded) && !tables ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> 실 DB 스키마를 읽는 중…
        </div>
      ) : ready ? (
        <ReactFlowProvider key={`${conn.id}:${nonce}`}>
          <div className="flex min-h-0 flex-1">
            <DiagramTablePanel tables={visibleTables} selectedId={selected} onSelect={setSelected} />
            <div className="relative min-w-0 flex-1">
              <DiagramCanvas
                tables={visibleTables}
                connectionId={conn.id}
                connName={conn.name}
                storedPositions={storedPositions}
                storedViewport={storedViewport}
                selected={selected}
                onSelect={setSelected}
                hideIsolated={hideIsolated}
                onToggleIsolated={() => setHideIsolated((v) => !v)}
              />
            </div>
          </div>
        </ReactFlowProvider>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">테이블이 없습니다</div>
      )}
    </div>
  )
}
