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
  useReactFlow
} from '@xyflow/react'
import type { Node, Edge, NodeMouseHandler, Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { KeyRound, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import type { ConnectionDef } from '../../connections/store'
import type { DialectId } from '../../dialects'
import type { TableDef } from '../../workspaces/definition/types'
import { buildErd } from '../diagram/graph'
import { estimateEdgeLabelWidth, estimateNodeSize, layoutErd, type Positions } from '../diagram/layout'
import { seedNodes } from '../diagram/seed'
import { matchTables } from '../diagram/filter'
import { TableErdNode } from '../diagram/TableErdNode'
import { RelationErdEdge } from '../diagram/RelationErdEdge'
import { DiagramTablePanel } from '../diagram/DiagramTablePanel'
import { buildFkPatch } from '../../workspaces/diagram/fk'
import { useSchemaEditStore } from './store'
import { PreviewBar } from './PreviewBar'

const nodeTypes = { tableErd: TableErdNode }
const edgeTypes = { relationErd: RelationErdEdge }

/** buildErd + dagre → @xyflow Node/Edge. 편집이라 모든 컬럼에 관계 핸들을 연다(editable:true). */
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
    data: { table: n.table, selected: false, highlighted: false, matched: false, dimmed: false, compact: false, editable: true }
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

/** 선택 테이블의 컬럼·관계 편집 사이드 패널(draft 대상). Studio EditPanel 과 같은 동선. */
function EditPanel({ table }: { table: TableDef }) {
  const st = useSchemaEditStore
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
          title="테이블 삭제"
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
            <button
              type="button"
              aria-pressed={pkCols.has(col.id)}
              title="Primary Key 토글"
              onClick={() => st.getState().togglePk(col.id)}
              className={cn('shrink-0 rounded p-0.5', pkCols.has(col.id) ? 'text-accent-2' : 'text-muted/40 hover:text-muted')}
            >
              <KeyRound className="size-3.5" />
            </button>
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
        {fks.length === 0 ? (
          <p className="text-[11px] text-muted">노드의 컬럼 오른쪽 점을 다른 테이블로 끌어 관계를 만듭니다.</p>
        ) : (
          fks.map((fk) => (
            <div key={fk.id} className="flex items-center gap-1.5 rounded border border-line bg-canvas px-2 py-1 text-[11px]">
              <span className="min-w-0 flex-1 truncate font-mono text-fg">
                {fk.columns.map((r) => nameById.get(r.columnId) ?? r.columnId).join(', ')} → {fk.refTable}({(fk.refColumns ?? []).join(', ')})
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
    </aside>
  )
}

function EditCanvas({
  tables,
  connId,
  dialect,
  storedPositions
}: {
  tables: TableDef[]
  connId: string
  dialect: DialectId
  storedPositions: Positions
}) {
  const rf = useReactFlow()
  const setActive = useSchemaEditStore((s) => s.setActiveTable)
  const addFk = useSchemaEditStore((s) => s.addFk)
  const addTable = useSchemaEditStore((s) => s.addTable)
  const activeId = useSchemaEditStore((s) => s.activeTableId)

  const [query, setQuery] = useState('')
  const [compact, setCompact] = useState(false)
  const base = useMemo(() => toFlow(tables), [tables])
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
    const positions: Positions = {}
    for (const n of rf.getNodes()) positions[n.id] = { x: n.position.x, y: n.position.y }
    const vp = rf.getViewport()
    void window.rockury.diagram
      .saveLayout({ connectionId: connId, positions, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
      .catch(() => {})
  }, [rf, connId])

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

  useEffect(() => {
    const nbrs = activeId ? (neighbors.get(activeId) ?? new Set<string>()) : new Set<string>()
    const searching = query.trim().length > 0
    setNodes((prev) =>
      prev.map((n) => {
        const isMatch = matched.has(n.id)
        return {
          ...n,
          data: { ...n.data, selected: n.id === activeId, highlighted: nbrs.has(n.id), matched: isMatch, dimmed: searching && !isMatch && n.id !== activeId, compact }
        }
      })
    )
  }, [activeId, neighbors, matched, query, compact, setNodes])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setActive(node.id), [setActive])
  const onNodeDragStop = useCallback(() => persist(), [persist])
  const onMoveEnd = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 800)
  }, [persist])

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle) return
      const src = tables.find((t) => t.id === c.source)
      const tgt = tables.find((t) => t.id === c.target)
      if (!src || !tgt) return
      const patch = buildFkPatch(src, c.sourceHandle, tgt)
      if (patch) addFk(src.id, patch)
    },
    [tables, addFk]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      onConnect={onConnect}
      nodesDraggable
      nodesConnectable
      elementsSelectable
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={null}
      fitView
    >
      <Background gap={16} size={1} color="var(--color-line)" />
      <Controls showInteractive={false} position="top-left" />
      <MiniMap zoomable pannable nodeStrokeWidth={3} className="!bg-panel" />
      <Panel position="top-right">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas/95 p-1.5 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="테이블/컬럼 검색"
              className="selectable h-7 w-36 rounded-md border border-line bg-canvas pl-7 pr-2 text-[12px] text-fg outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
          <button
            type="button"
            aria-pressed={compact}
            title="컬럼을 접고 테이블만"
            onClick={() => setCompact((v) => !v)}
            className={cn('h-7 rounded-md px-2 text-[12px] font-medium transition-colors', compact ? 'bg-accent text-white' : 'text-muted hover:bg-panel hover:text-fg')}
          >
            간략
          </button>
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => addTable(dialect)}>
            <Plus /> 테이블
          </Button>
        </div>
      </Panel>
    </ReactFlow>
  )
}

/**
 * Console › Diagram 편집 모드 — draft(useSchemaEditStore)를 편집 가능한 ERD 로 그린다.
 * 노드 클릭 → 편집 패널, 컬럼 핸들 드래그 → FK 생성, 상단 + → 테이블 추가. 하단 미리보기 바로 적용.
 * 시각 레이어(TableErdNode/RelationErdEdge/graph/layout)는 읽기 Diagram·Studio 와 공유.
 */
export function DiagramEdit({ conn }: { conn: ConnectionDef }) {
  const draft = useSchemaEditStore((s) => s.draft)
  const activeId = useSchemaEditStore((s) => s.activeTableId)
  const addTable = useSchemaEditStore((s) => s.addTable)
  const [storedPositions, setStoredPositions] = useState<Positions>({})
  const [layoutLoaded, setLayoutLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLayoutLoaded(false)
    void window.rockury.diagram
      .getLayout(conn.id)
      .then((l) => {
        if (!alive) return
        setStoredPositions(l?.positions ?? {})
        setLayoutLoaded(true)
      })
      .catch(() => alive && setLayoutLoaded(true))
    return () => {
      alive = false
    }
  }, [conn.id])

  const selected = draft.find((t) => t.id === activeId) ?? null

  const setActiveTable = useSchemaEditStore((s) => s.setActiveTable)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!layoutLoaded ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">배치 불러오는 중…</div>
        ) : draft.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
            편집할 테이블이 없습니다.
            <Button size="sm" variant="outline" onClick={() => addTable(conn.dbType)}>
              <Plus /> 첫 테이블 추가
            </Button>
          </div>
        ) : (
          <ReactFlowProvider key={conn.id}>
            {/* 읽기 Diagram 과 같은 좌측 목록 — 편집 중에도 테이블을 찾아 옮겨 다닐 수 있어야 한다. */}
            <DiagramTablePanel tables={draft} selectedId={activeId} onSelect={setActiveTable} />
            <div className="relative min-w-0 flex-1">
              <EditCanvas tables={draft} connId={conn.id} dialect={conn.dbType} storedPositions={storedPositions} />
            </div>
            {selected && <EditPanel table={selected} />}
          </ReactFlowProvider>
        )}
      </div>
      <PreviewBar dialect={conn.dbType} />
    </div>
  )
}
