import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Node, Edge, NodeMouseHandler, Viewport, Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng, toSvg } from 'html-to-image'
import { GitBranch, Search, X, Plus, Trash2, Eye, KeyRound, LayoutGrid, Lock } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import type { TableDef } from '../definition/types'
import { useActiveDesign } from '../../designs/store'
import { useDefinitionStore, useDesignTables, useStudioReadOnly } from '../definition/store'
import { buildErd } from '../../console/diagram/graph'
import { estimateEdgeLabelWidth, estimateNodeSize, layoutErd, type Positions } from '../../console/diagram/layout'
import { seedNodes } from '../../console/diagram/seed'
import { matchTables } from '../../console/diagram/filter'
import { exportFileName, exportViewport, contentBoundsForExport } from '../../console/diagram/export'
import { TableErdNode } from '../../console/diagram/TableErdNode'
import { RelationErdEdge } from '../../console/diagram/RelationErdEdge'
import { DiagramTablePanel } from '../../console/diagram/DiagramTablePanel'
import { buildFkPatch } from './fk'

const nodeTypes = { tableErd: TableErdNode }
const edgeTypes = { relationErd: RelationErdEdge }

/** buildErd + dagre → @xyflow Node/Edge. editable 면 노드가 모든 컬럼에 관계 핸들을 연다. */
function toFlow(tables: TableDef[], editable: boolean): { nodes: Node[]; edges: Edge[] } {
  const erd = buildErd(tables)
  const positions = layoutErd(
    erd.nodes.map((n) => ({ id: n.id, ...estimateNodeSize(n.table) })),
    erd.edges.map((e) => ({ source: e.source, target: e.target, labelWidth: estimateEdgeLabelWidth(e) }))
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
  tables: TableDef[]
  scopeKey: string
  designName: string
  editable: boolean
  storedPositions: Positions
  storedViewport: Viewport | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onConnectFk: (c: Connection) => void
}

function StudioCanvas({
  tables,
  scopeKey,
  designName,
  editable,
  storedPositions,
  storedViewport,
  selectedId,
  onSelect,
  onConnectFk
}: CanvasProps) {
  const rf = useReactFlow()
  const [query, setQuery] = useState('')
  const [compact, setCompact] = useState(false)
  const [exportStatus, setExportStatus] = useState<'idle' | 'ok' | 'err'>('idle')

  const base = useMemo(() => toFlow(tables, editable), [tables, editable])
  const matched = useMemo(() => matchTables(tables, query), [tables, query])

  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges)
  const seededRef = useRef(false)
  // 직전 effect 실행 시점의 노드 id 집합 — grew(새 테이블 등장) 판정을 updater 밖에서 하기 위함.
  const prevIdsRef = useRef<Set<string>>(new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const e of base.edges) {
      ;(map.get(e.source) ?? map.set(e.source, new Set()).get(e.source)!).add(e.target)
      ;(map.get(e.target) ?? map.set(e.target, new Set()).get(e.target)!).add(e.source)
    }
    return map
  }, [base.edges])

  const persist = useCallback(() => {
    if (!editable) return
    const positions: Positions = {}
    for (const n of rf.getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y }
    const vp = rf.getViewport()
    void window.rockury.diagram
      .saveLayout({ connectionId: scopeKey, positions, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
      .catch(() => {})
  }, [rf, scopeKey, editable])

  // 스키마/편집 변경 시 재배치 — 첫 seed 는 저장 위치, 이후엔 현재 화면 위치 보존(새 테이블만 dagre).
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

  // 선택/검색/간략 → 노드 data 데코.
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
        a.download = exportFileName(designName, format, new Date())
        document.body.appendChild(a)
        a.click()
        a.remove()
        setExportStatus('ok')
      } catch {
        setExportStatus('err')
      }
    },
    [rf, designName]
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
      onConnect={onConnectFk}
      nodesDraggable={editable}
      nodesConnectable={editable}
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
          <button
            type="button"
            aria-pressed={compact}
            title="컬럼을 접고 테이블만"
            onClick={() => setCompact((v) => !v)}
            className={cn(
              'h-7 rounded-md px-2 text-[12px] font-medium transition-colors',
              compact ? 'bg-accent text-white' : 'text-muted hover:bg-panel hover:text-fg'
            )}
          >
            간략
          </button>
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

/** 선택된 테이블의 컬럼·관계 편집 사이드 패널(Draft 전용). 모든 편집은 활성 테이블 대상. */
function EditPanel({ table, allTables }: { table: TableDef; allTables: TableDef[] }) {
  const st = useDefinitionStore
  const pkCols = useMemo(() => {
    const pk = table.constraints.find((c) => c.kind === 'pk')
    return new Set(pk?.columns.map((r) => r.columnId) ?? [])
  }, [table])
  const fks = table.constraints.filter((c) => c.kind === 'fk')
  const nameById = useMemo(() => new Map(table.columns.map((c) => [c.id, c.name])), [table])

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <input
          value={table.name}
          onChange={(e) => st.getState().updateTable({ name: e.target.value })}
          className="selectable min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono text-[13px] font-semibold text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          title={table.isView ? '뷰 삭제' : '테이블 삭제'}
          onClick={() => st.getState().deleteTable(table.id)}
          className="shrink-0 rounded p-1 text-muted hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">컬럼</span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => st.getState().addColumn()}>
            <Plus className="size-3" /> 추가
          </Button>
        </div>
        {table.columns.map((col) => (
          <div key={col.id} className="flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-1">
            {!table.isView && (
              <button
                type="button"
                aria-pressed={pkCols.has(col.id)}
                title="Primary Key 토글"
                onClick={() => st.getState().togglePk(col.id)}
                className={cn(
                  'shrink-0 rounded p-0.5',
                  pkCols.has(col.id) ? 'text-accent-2' : 'text-muted/40 hover:text-muted'
                )}
              >
                <KeyRound className="size-3.5" />
              </button>
            )}
            <input
              value={col.name}
              placeholder="컬럼명"
              onChange={(e) => st.getState().updateColumn(col.id, { name: e.target.value })}
              className="selectable w-20 min-w-0 flex-1 rounded bg-transparent px-1 font-mono text-[12px] text-fg outline-none focus:bg-panel"
            />
            <input
              value={col.type}
              placeholder="타입"
              onChange={(e) => st.getState().updateColumn(col.id, { type: e.target.value })}
              className="selectable w-20 shrink-0 rounded bg-transparent px-1 text-right font-mono text-[11px] text-muted outline-none focus:bg-panel"
            />
            <button
              type="button"
              title={col.nullable ? 'NULL 허용' : 'NOT NULL'}
              onClick={() => st.getState().toggleNullable(col.id)}
              className={cn('shrink-0 rounded px-1 text-[10px] font-bold', col.nullable ? 'text-muted' : 'text-fg')}
            >
              {col.nullable ? 'NULL' : 'N-N'}
            </button>
            <button
              type="button"
              title="컬럼 삭제"
              onClick={() => st.getState().deleteColumn(col.id)}
              className="shrink-0 rounded p-0.5 text-muted/50 hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">관계(FK)</span>
        {table.isView ? (
          <p className="text-[11px] text-muted">
            뷰에는 관계(FK)를 걸 수 없어요 — 본문 SELECT 는 Definition 에서 씁니다.
          </p>
        ) : fks.length === 0 ? (
          <p className="text-[11px] text-muted">
            노드의 컬럼 오른쪽 점을 다른 테이블로 끌어 관계를 만듭니다.
          </p>
        ) : (
          fks.map((fk) => (
            <div key={fk.id} className="flex items-center gap-1.5 rounded border border-line bg-canvas px-2 py-1 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-fg">
                {fk.columns.map((r) => nameById.get(r.columnId) ?? r.columnId).join(', ')} →{' '}
                {fk.refTable}({(fk.refColumns ?? []).join(', ')})
              </span>
              <button
                type="button"
                title="관계 삭제"
                onClick={() => st.getState().deleteConstraint(fk.id)}
                className="shrink-0 rounded p-0.5 text-muted/50 hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      {/* allTables 는 향후 FK 대상 드롭다운 편집에 쓰기 위해 받아둔다(현재는 드래그 생성). */}
      <span className="hidden">{allTables.length}</span>
    </aside>
  )
}

/**
 * Studio › Diagram(설계부 · depth 3) — 활성 설계의 **가상 ERD 편집기**.
 * 표시는 useDesignTables(Draft/커밋 렌즈), 편집은 useDefinitionStore 액션(저장은 자동 write-through).
 * 관계는 컬럼 핸들을 끌어 생성, 위치는 설계 스코프(`design:<id>`)로 영속. 시각 레이어는 console/diagram 재사용.
 */
export function StudioDiagramWorkspace() {
  const design = useActiveDesign()
  const readOnly = useStudioReadOnly()
  const scoped = useDesignTables()
  const addTable = useDefinitionStore((s) => s.addTable)
  const addView = useDefinitionStore((s) => s.addView)

  // useDesignTables 는 매 렌더 새 배열 → 콘텐츠 기준으로 identity 안정화(재배치 폭주 방지).
  const scopedSig = JSON.stringify(scoped)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => scoped, [scopedSig])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [storedPositions, setStoredPositions] = useState<Positions>({})
  const [storedViewport, setStoredViewport] = useState<Viewport | null>(null)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)

  const scopeKey = design ? `design:${design.id}` : ''

  useEffect(() => {
    if (!design) return
    let alive = true
    setLayoutLoaded(false)
    void window.rockury.diagram
      .getLayout(`design:${design.id}`)
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
  }, [design?.id, nonce])

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) useDefinitionStore.getState().setActiveTable(id)
  }, [])

  const handleConnectFk = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target || !c.sourceHandle) return
      const src = tables.find((t) => t.id === c.source)
      const tgt = tables.find((t) => t.id === c.target)
      if (!src || !tgt) return
      // 뷰에는 FK 를 걸 수 없다(양쪽 어디든) — 끌어다 놓아도 조용히 무시한다.
      if (src.isView || tgt.isView) return
      const patch = buildFkPatch(src, c.sourceHandle, tgt)
      if (!patch) return
      const st = useDefinitionStore.getState()
      st.setActiveTable(src.id)
      st.addConstraint('fk')
      const newId = useDefinitionStore.getState().openConstraintId
      if (newId) st.updateConstraint(newId, patch)
    },
    [tables, readOnly]
  )

  const resetLayout = useCallback(async () => {
    if (!design) return
    await window.rockury.diagram.clearLayout(`design:${design.id}`).catch(() => {})
    setStoredPositions({})
    setStoredViewport(null)
    setNonce((x) => x + 1)
  }, [design?.id])

  if (!design) {
    return (
      <PlaceholderView
        icon={GitBranch}
        depth="depth 3 · Studio › Diagram"
        title="설계를 선택하세요"
        subtitle="상단 컨텍스트 바의 Design 셀렉터에서 설계를 고르면 그 설계의 테이블을 ERD 로 그리고 편집합니다."
      />
    )
  }

  const selected = selectedId ? tables.find((t) => t.id === selectedId) ?? null : null
  const ready = layoutLoaded

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex flex-col">
          <h2 className="text-[14px] font-bold text-fg">
            Diagram <span className="font-normal text-muted">· {design.name}</span>
            {readOnly && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-panel-strong px-1.5 py-0.5 text-[10px] text-muted">
                <Lock className="size-3" /> 읽기 전용(커밋 버전)
              </span>
            )}
          </h2>
          <p className="text-[12px] text-muted">
            {tables.length}개 테이블 · 가상 ERD {readOnly ? '· 열람' : '· 편집(관계는 컬럼 점을 끌어 연결)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void resetLayout()}>
            <LayoutGrid /> 자동 배치
          </Button>
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" onClick={() => addTable(design.id)}>
                <Plus /> 테이블 추가
              </Button>
              <Button size="sm" variant="ghost" onClick={() => addView(design.id)}>
                <Eye /> 뷰 추가
              </Button>
            </>
          )}
        </div>
      </div>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">불러오는 중…</div>
      ) : tables.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
          이 설계에는 테이블이 없습니다.
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => addTable(design.id)}>
              <Plus /> 첫 테이블 추가
            </Button>
          )}
        </div>
      ) : (
        <ReactFlowProvider key={`${design.id}:${nonce}`}>
          <div className="flex flex-1 overflow-hidden">
            <DiagramTablePanel tables={tables} selectedId={selectedId} onSelect={handleSelect} />
            <div className="relative min-w-0 flex-1">
              <StudioCanvas
                tables={tables}
                scopeKey={scopeKey}
                designName={design.name}
                editable={!readOnly}
                storedPositions={storedPositions}
                storedViewport={storedViewport}
                selectedId={selectedId}
                onSelect={handleSelect}
                onConnectFk={handleConnectFk}
              />
            </div>
            {!readOnly && selected && <EditPanel table={selected} allTables={tables} />}
          </div>
        </ReactFlowProvider>
      )}
    </div>
  )
}
