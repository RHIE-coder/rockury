import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FolderPlus,
  Loader2,
  Play,
  Route,
  Search,
  Table2,
  Terminal,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { SqlEditor } from '@renderer/ui/SqlEditor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import type { TableDef } from '../workspaces/definition/types'
import type { DialectId } from '../dialects'
import { useActiveConnection } from '../connections/store'
import { useConsoleStore } from './store'
import { columnKeyKinds } from './introspection'
import { badgeLabels } from './data/columnMeta'
import { buildSchemaMap, formatSql } from './query/schema'
import { applyKeywords, extractKeywords } from './query/keywords'
import { parseExplainTree } from './query/explainTree'
import { toCsv, toJson } from './data/exportRows'
import { useQueryStore } from './query/store'
import { flattenTree, getProjection, removeChildrenOf, type FlatNode } from './collection/tree'
import { toLibNodes, useCollectionStore } from './collection/store'

const MAX_ROWS = 500
const INDENT = 14

function cell(v: unknown): { text: string; muted?: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', muted: true }
  if (typeof v === 'object') return { text: JSON.stringify(v) }
  return { text: String(v) }
}

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Console › Query(운영부 · depth 3) — 저장 쿼리를 "객체"로 관리(레거시 rky-mvp 이식).
 * 좌: 저장쿼리 폴더/파일 트리(검색·새폴더/쿼리·우클릭 rename/move/delete·DnD).
 * 중앙: 선택 쿼리 편집기(이름/설명 인라인 편집 + 자동저장, {{키워드}} 파라미터, Run/Format/EXPLAIN) + 결과.
 * 우: Schema 패널(토글, 테이블/뷰·컬럼). DML 은 트랜잭션 게이트.
 */
export function QueryView() {
  const conn = useActiveConnection()
  const tables = useConsoleStore((s) => (conn ? s.byEnv[conn.id] : undefined))
  const loadIntro = useConsoleStore((s) => s.load)
  const lib = useCollectionStore()

  const sql = useQueryStore((s) => s.sql)
  const setSql = useQueryStore((s) => s.setSql)
  const activeId = useQueryStore((s) => s.activeSavedQueryId)
  const activeConn = useQueryStore((s) => s.activeSavedConn)
  const loadSaved = useQueryStore((s) => s.loadSaved)
  const result = useQueryStore((s) => s.result)
  const error = useQueryStore((s) => s.error)
  const loading = useQueryStore((s) => s.loading)
  const ddlWarning = useQueryStore((s) => s.ddlWarning)
  const tx = useQueryStore((s) => s.tx)
  const explaining = useQueryStore((s) => s.explaining)
  const explain = useQueryStore((s) => s.explain)
  const run = useQueryStore((s) => s.run)
  const runExplain = useQueryStore((s) => s.runExplain)
  const confirm = useQueryStore((s) => s.confirm)
  const rollback = useQueryStore((s) => s.rollback)
  const dismissError = useQueryStore((s) => s.dismissError)

  const [showSchema, setShowSchema] = useState(true)
  const [treeFilter, setTreeFilter] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string; kind: 'folder' | 'query' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [offsetLeft, setOffsetLeft] = useState(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (conn) {
      void loadIntro(conn.id, conn.id)
      void lib.load(conn.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  // 자동저장(디바운스 1s) — 라이브러리 쿼리 SQL. 저장쿼리 연결 스코프.
  useEffect(() => {
    if (!activeId || activeConn !== conn?.id) return
    const t = setTimeout(() => void window.rockury.savedQueries.updateQuery(activeId, { sql }), 1000)
    return () => clearTimeout(t)
  }, [sql, activeId, activeConn, conn?.id])

  const keywords = useMemo(() => extractKeywords(sql), [sql])
  const [kw, setKw] = useState<Record<string, string>>({})
  const missing = keywords.filter((k) => !(kw[k]?.trim()))

  if (!conn) {
    return (
      <PlaceholderView
        icon={Terminal}
        depth="depth 3 · Console › Query"
        title="연결을 선택하세요"
        subtitle="상단 컨텍스트 바의 Connection 셀렉터에서 대상을 고르면 SQL 을 실행할 수 있습니다."
      />
    )
  }

  const flat = flattenTree(toLibNodes(lib.folders, lib.queries))
  const q = treeFilter.trim().toLowerCase()
  const visible = (dragId ? removeChildrenOf(flat, [dragId]) : flat).filter(
    (n) => !q || n.name.toLowerCase().includes(q)
  )
  const active = lib.queries.find((x) => x.id === activeId) ?? null

  const rows = result?.rows ?? []
  const shown = rows.slice(0, MAX_ROWS)
  const canRun = !loading && sql.trim().length > 0 && !tx && missing.length === 0
  const effectiveSql = (): string => applyKeywords(sql, kw)

  const selectQuery = (id: string, s: string): void => loadSaved(id, s, conn.id)

  const newQuery = async (folderId: string | null = null): Promise<void> => {
    const rec = await window.rockury.savedQueries.createQuery({ connectionId: conn.id, folderId, name: 'Untitled Query', sql: '' })
    await lib.load(conn.id)
    selectQuery(rec.id, '')
  }

  const renameNode = (kind: 'folder' | 'query', id: string, name: string): void => void lib.rename(kind, id, name)
  const patchActive = (patch: { name?: string; description?: string }): void => {
    if (!activeId) return
    void window.rockury.savedQueries.updateQuery(activeId, patch).then(() => lib.load(conn.id))
  }

  const onDragStart = (e: DragStartEvent): void => setDragId(String(e.active.id))
  const onDragMove = (e: DragMoveEvent): void => setOffsetLeft(e.delta.x)
  const onDragEnd = (e: DragEndEvent): void => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setDragId(null)
    setOffsetLeft(0)
    if (!over) return
    const proj = getProjection(visible, a, over, Math.round(offsetLeft / INDENT))
    const ids = visible.map((n) => n.id)
    const from = ids.indexOf(a)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...visible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    void lib.applyReorder(reordered.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === a ? proj.parentId : n.parentId })))
  }

  const moveTo = (id: string, kind: 'folder' | 'query', parentId: string | null): void => {
    void lib.applyReorder(flat.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === id ? parentId : n.parentId })))
    setCtx(null)
    void id
    void kind
  }

  return (
    <div className="flex h-full min-h-0" onClick={() => ctx && setCtx(null)}>
      {/* 좌: QUERIES 트리 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>Queries</span>
          <div className="flex items-center gap-1">
            <button type="button" title="새 폴더" onClick={() => void lib.addFolder('New Folder')} className="text-muted hover:text-fg"><FolderPlus className="size-3.5" /></button>
            <button type="button" title="새 쿼리" onClick={() => void newQuery()} className="text-muted hover:text-fg"><FilePlus2 className="size-3.5" /></button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-b border-line px-2 pb-2">
          <Search className="size-3.5 text-muted" />
          <input value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} placeholder="Filter queries..." className="w-full bg-transparent text-[12px] outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {visible.map((n) => (
                <QueryTreeRow
                  key={n.id}
                  node={n}
                  active={n.kind === 'query' && n.id === activeId}
                  editing={editingId === n.id}
                  onSelect={() => n.kind === 'query' && selectQuery(n.id, n.sql ?? '')}
                  onEditStart={() => setEditingId(n.id)}
                  onEditEnd={() => setEditingId(null)}
                  onRename={(name) => renameNode(n.kind, n.id, name)}
                  onContext={(x, y) => setCtx({ x, y, id: n.id, kind: n.kind })}
                />
              ))}
            </SortableContext>
          </DndContext>
          {flat.length === 0 && <div className="px-4 py-2 text-[11.5px] text-muted">저장된 쿼리가 없어요. + 로 새 쿼리를 만드세요.</div>}
        </div>
      </aside>

      {/* 중앙: 편집기 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-5 py-2.5">
          <div className="min-w-0 flex-1">
            {active ? (
              <>
                <input
                  key={active.id}
                  defaultValue={active.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== active.name && patchActive({ name: e.target.value.trim() })}
                  className="w-full max-w-md bg-transparent text-[15px] font-bold text-fg outline-none"
                />
                <input
                  key={`${active.id}-desc`}
                  defaultValue={active.description}
                  onBlur={(e) => e.target.value !== active.description && patchActive({ description: e.target.value })}
                  placeholder="Add description..."
                  className="mt-0.5 w-full max-w-md bg-transparent text-[12px] text-muted outline-none"
                />
              </>
            ) : (
              <>
                <h2 className="text-[15px] font-bold text-fg">Untitled Query <span className="text-[11px] font-normal text-muted">· 미저장</span></h2>
                <button type="button" onClick={() => void newQuery()} className="mt-0.5 text-[12px] text-accent hover:underline">라이브러리에 저장하기</button>
              </>
            )}
          </div>
          <Button size="sm" variant={showSchema ? 'soft' : 'outline'} title="스키마 패널" onClick={() => setShowSchema((v) => !v)}>
            <Table2 /> Schema
          </Button>
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-1.5 text-[12px]">
          <span className="font-semibold text-muted">SQL Editor</span>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] text-muted">⌘+Enter to run</span>
            <Button size="sm" variant="outline" disabled={!sql.trim()} title="SQL 정형화" onClick={() => setSql(formatSql(sql, conn.dbType))}><WandSparkles /></Button>
            <Button size="sm" variant="outline" disabled={!sql.trim() || explaining || loading || missing.length > 0} title="실행 계획(EXPLAIN)" onClick={() => void runExplain(conn.id, effectiveSql())}>
              {explaining ? <Loader2 className="animate-spin" /> : <Route />}
            </Button>
            <Button size="sm" disabled={!canRun} onClick={() => void run(conn.id, effectiveSql())}>
              {loading ? <Loader2 className="animate-spin" /> : <Play />} Run
            </Button>
          </div>
        </div>

        <div className="h-44 shrink-0 overflow-auto border-b border-line px-2 py-1">
          <SqlEditor
            value={sql}
            onChange={setSql}
            onRun={() => canRun && void run(conn.id, effectiveSql())}
            schema={buildSchemaMap(tables ?? [])}
            dialect={conn.dbType}
            placeholder="SELECT * FROM users WHERE id = {{userId}};"
          />
        </div>

        {keywords.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/40 px-5 py-2 text-[12px]">
            <span className="text-muted">파라미터:</span>
            {keywords.map((k) => (
              <label key={k} className="flex items-center gap-1">
                <span className="font-mono text-[11px] text-accent">{`{{${k}}}`}</span>
                <input value={kw[k] ?? ''} onChange={(e) => setKw((v) => ({ ...v, [k]: e.target.value }))} placeholder="값" className="h-7 w-32 rounded border border-line bg-canvas px-1.5 text-[12px] outline-none" />
              </label>
            ))}
            {missing.length > 0 && <span className="text-[11px] text-destructive">미입력: {missing.join(', ')}</span>}
          </div>
        )}

        {tx && (
          <div className={cn('flex shrink-0 items-center gap-3 border-b px-5 py-2.5 text-[12.5px]', tx.destructive ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-accent/30 bg-accent-soft/50 text-fg')}>
            {tx.destructive && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
            <span className="min-w-0 flex-1"><span className="font-semibold">{tx.verb}</span> 실행됨 · 영향 <span className="font-mono font-semibold">{tx.affectedRows}</span>행 · 아직 커밋되지 않았습니다{tx.destructive && ' — WHERE 절이 없어 전체가 영향받습니다'}</span>
            <Button size="sm" variant="ghost" onClick={() => void rollback()}>롤백</Button>
            <Button size="sm" variant={tx.destructive ? 'destructive' : 'default'} onClick={() => void confirm()}>커밋</Button>
          </div>
        )}
        {ddlWarning && !tx && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-5 py-2 text-[12px] text-muted"><AlertTriangle className="size-3.5" /> DDL 은 즉시 자동 커밋되었습니다(롤백 불가).</div>
        )}
        {explain && <ExplainPanel explain={explain} dialect={conn.dbType} />}
        {error && (
          <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
            <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{error}</span>
            <button type="button" onClick={dismissError} className="shrink-0 opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-[13px] text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> 실행 중…</div>
          ) : result && result.columns.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-panel">
                  <tr>
                    <th className="border-b border-line px-2 py-1.5 text-right font-medium text-muted">#</th>
                    {result.columns.map((c) => <th key={c} className="border-b border-line px-3 py-1.5 text-left font-mono font-semibold text-fg">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => (
                    <tr key={i} className="hover:bg-panel/60">
                      <td className="border-b border-line/50 px-2 py-1 text-right font-mono text-muted">{i + 1}</td>
                      {result.columns.map((c) => {
                        const { text, muted } = cell(row[c])
                        return <td key={c} className={cn('max-w-[360px] truncate border-b border-line/50 px-3 py-1 font-mono', muted ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-3 px-5 py-2 text-[11px] text-muted">
                <span>{result.rowCount}행{rows.length > MAX_ROWS && ` · 상위 ${MAX_ROWS}행만 표시`}{typeof result.executionTimeMs === 'number' && ` · ${result.executionTimeMs}ms`}</span>
                <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => download('query-result.csv', toCsv(result.columns, rows), 'text/csv')}><Download className="size-3" /> CSV</button>
                <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => download('query-result.json', toJson(rows), 'application/json')}><Download className="size-3" /> JSON</button>
              </div>
            </div>
          ) : result ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted">
              <span>{typeof result.affectedRows === 'number' ? `${result.affectedRows}행 영향` : '결과 집합 없음'}</span>
              <span className="text-[11px]">{result.executionTimeMs}ms</span>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">SQL 을 실행하면 결과가 여기 표시됩니다</div>
          )}
        </div>
      </div>

      {showSchema && <SchemaPanel tables={tables ?? []} onInsert={(name) => setSql(sql + (sql && !sql.endsWith(' ') ? ' ' : '') + name)} onPreview={(t) => setPreview(t)} onClose={() => setShowSchema(false)} />}

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctx && (
        <div className="fixed z-50 w-52 rounded-md border border-line bg-canvas py-1 text-[12px] shadow-lg" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel" onClick={() => { setEditingId(ctx.id); setCtx(null) }}>이름 변경</button>
          {ctx.kind === 'query' && lib.folders.length > 0 && (
            <>
              <div className="px-3 pt-1.5 text-[10.5px] uppercase text-muted">Move to</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel" onClick={() => moveTo(ctx.id, ctx.kind, null)}>(최상위)</button>
              {lib.folders.map((f) => (
                <button key={f.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel" onClick={() => moveTo(ctx.id, ctx.kind, f.id)}>{f.name}</button>
              ))}
            </>
          )}
          <button type="button" className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-destructive hover:bg-panel" onClick={() => { void lib.remove(ctx.kind, ctx.id); setCtx(null) }}><Trash2 className="size-3.5" /> 삭제</button>
        </div>
      )}

      {preview && <TablePreviewModal connectionId={conn.id} dialect={conn.dbType} table={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** 트리 한 행 — 폴더/쿼리. 클릭 선택, 더블클릭/컨텍스트 이름변경, 우클릭 메뉴, DnD. */
function QueryTreeRow({ node, active, editing, onSelect, onEditStart, onEditEnd, onRename, onContext }: { node: FlatNode; active: boolean; editing: boolean; onSelect: () => void; onEditStart: () => void; onEditEnd: () => void; onRename: (name: string) => void; onContext: (x: number, y: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY) }}
      className={cn('flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-50', active && 'bg-accent-soft/60')}
    >
      <span {...attributes} {...listeners} className="cursor-grab text-muted">
        {node.kind === 'folder' ? <ChevronDown className="size-3.5" /> : <span className="inline-block w-3.5" />}
      </span>
      {editing ? (
        <input
          autoFocus
          defaultValue={node.name}
          onBlur={(e) => { onEditEnd(); if (e.target.value.trim() && e.target.value !== node.name) onRename(e.target.value.trim()) }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-6 w-40 rounded border border-line bg-canvas px-1 text-[12px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onEditStart}
          className={cn('min-w-0 flex-1 truncate text-left font-mono', node.kind === 'folder' ? 'font-semibold text-fg' : active ? 'font-semibold text-accent' : 'text-fg')}
          title={node.kind === 'query' ? node.sql : node.name}
        >
          {node.name}
        </button>
      )}
    </div>
  )
}

/** 스키마 사이드 패널 — 테이블/컬럼 트리 + 검색 + 클릭 삽입 + 테이블 미리보기. */
function SchemaPanel({ tables, onInsert, onPreview, onClose }: { tables: TableDef[]; onInsert: (name: string) => void; onPreview: (table: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const query = q.trim().toLowerCase()
  const filtered = tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)))
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Schema</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-fg"><X className="size-3.5" /></button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-2">
        <Search className="size-3.5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter..." className="w-full bg-transparent text-[12px] outline-none" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {filtered.map((t) => {
          const kinds = columnKeyKinds(t)
          const expanded = open[t.name] ?? !!query
          return (
            <div key={t.id}>
              <div className="flex items-center gap-1 px-2 py-1 text-[12px]">
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [t.name]: !expanded }))} className="text-muted">{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
                <button type="button" onClick={() => onInsert(t.name)} className={cn('min-w-0 flex-1 truncate text-left font-mono', t.isView ? 'text-accent' : 'font-semibold text-fg', 'hover:text-accent')} title="에디터에 삽입">{t.name}</button>
                <button type="button" onClick={() => onPreview(t.name)} className="text-muted hover:text-accent" title="미리보기(SELECT * LIMIT 50)"><Table2 className="size-3" /></button>
                <span className="text-[10.5px] text-muted">{t.columns.length}</span>
              </div>
              {expanded && t.columns.map((c) => {
                const badges = badgeLabels(kinds.get(c.id))
                return (
                  <button key={c.id} type="button" onClick={() => onInsert(c.name)} className="flex w-full items-center gap-1.5 py-0.5 pl-8 pr-2 text-left font-mono text-[11px] text-muted hover:bg-panel hover:text-accent">
                    {badges.map((b) => <span key={b} className="rounded bg-accent-soft px-1 text-[8.5px] font-bold text-accent">{b}</span>)}
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-[10px] opacity-60">{c.type}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="px-3 py-2 text-[11.5px] text-muted">일치 없음</div>}
      </div>
    </aside>
  )
}

/** EXPLAIN 패널 — 요약 + 재귀 트리. */
function ExplainPanel({ explain, dialect }: { explain: { summary: string; planRows: Record<string, unknown>[]; explainSql: string }; dialect: DialectId }) {
  const [open, setOpen] = useState(true)
  const tree = parseExplainTree(explain.planRows, dialect)
  return (
    <div className="max-h-64 shrink-0 overflow-auto border-b border-line bg-panel/50 px-5 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[12px] text-fg outline-none">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Route className="size-3.5 text-accent" />
        <span className="font-semibold">실행 계획</span>
        {explain.summary && <span className="text-muted">· {explain.summary}</span>}
      </button>
      {open && <div className="mt-1.5">{tree ? <JsonTree data={tree} /> : <div className="font-mono text-[11px] text-muted">{explain.explainSql}</div>}</div>}
    </div>
  )
}

/** 재귀 JSON 트리 — 접기/펼치기(EXPLAIN 계획용). */
function JsonTree({ data, depth = 0, label }: { data: unknown; depth?: number; label?: string }) {
  const [open, setOpen] = useState(depth < 3)
  const isObj = data !== null && typeof data === 'object'
  if (!isObj) {
    return (
      <div style={{ paddingLeft: depth * 12 }} className="font-mono text-[11px] leading-relaxed">
        {label != null && <span className="text-muted">{label}: </span>}
        <span className="text-fg">{String(data)}</span>
      </div>
    )
  }
  const entries: [string, unknown][] = Array.isArray(data) ? data.map((v, i) => [String(i), v]) : Object.entries(data as Record<string, unknown>)
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-mono text-[11px] text-muted outline-none hover:text-fg">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label != null ? label : Array.isArray(data) ? `[${entries.length}]` : '{ }'}
      </button>
      {open && entries.map(([k, v]) => <JsonTree key={k} data={v} depth={depth + 1} label={k} />)}
    </div>
  )
}

/** 테이블 미리보기 모달 — SELECT * … LIMIT 50. */
function TablePreviewModal({ connectionId, dialect, table, onClose }: { connectionId: string; dialect: string; table: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const qc = dialect === 'mysql' || dialect === 'mariadb' ? '`' : '"'
  const ref = useRef(table)
  useEffect(() => {
    void (async () => {
      try {
        const r = await window.rockury.query.run(connectionId, `SELECT * FROM ${qc}${ref.current}${qc} LIMIT 50`)
        setRows(r.rows)
        setCols(r.columns)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>미리보기 · {table} (상위 50행)</DialogTitle></DialogHeader>
        {err ? (
          <div className="rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{err}</div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel"><tr>{cols.map((c) => <th key={c} className="border-b border-line px-2 py-1 text-left font-mono">{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-panel/60">
                    {cols.map((c) => {
                      const { text, muted } = cell(row[c])
                      return <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', muted ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="py-6 text-center text-[12px] text-muted">행이 없습니다</div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
