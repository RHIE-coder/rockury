import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
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
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
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
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { RowDetailDialog } from './RowDetailDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import type { TableDef } from '../workspaces/definition/types'
import type { DialectId } from '../dialects'
import { downloadText } from '../download'
import { useActiveConnection } from '../connections/store'
import { useActiveDesign } from '../designs/store'
import { useScopedDesignTables } from '../workspaces/definition/store'
import { qualifiedName, type TableRef } from '../schemaRef'
import { quoteTable, type SqlDialect } from './data/sqlBuilder'
import { useRemoteStore } from './store'
import { ConnectionError } from './ConnectionError'
import { columnKeyKinds } from './introspection'
import { badgeLabels } from './data/columnMeta'
import { buildSchemaMap, formatSql } from './query/schema'
import { applyKeywords, extractKeywords } from './query/keywords'
import { parseExplainTree } from './query/explainTree'
import { toCsv, toJson } from './data/exportRows'
import { useQueryStore } from './query/store'
import { createSqlSaver, type SqlSaver } from './query/autosave'
import { flattenTree, getProjection, moveTargets, removeChildrenOf, type FlatNode } from './collection/tree'
import { toLibNodes, useCollectionStore } from './collection/store'
import { TreeContextMenu } from './collection/TreeMenu'

const MAX_ROWS = 500
const INDENT = 14
const ROOT_ZONE = 'q-root-zone'

/** 트리 하단 빈 영역 = 최상위(root) 드롭존. 놓일 자리를 고스트 행으로 미리보기. */
function RootDropZone({ active, preview }: { active: boolean; preview: { name: string; isFolder: boolean } | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_ZONE })
  return (
    <div ref={setNodeRef} className="min-h-[80px] w-full">
      {active && isOver && preview && (
        <div className="mx-1 mt-0.5 flex items-center gap-1.5 rounded border border-dashed border-accent bg-accent-soft/30 py-1 pl-2 pr-3 text-[12px] text-accent">
          {preview.isFolder ? <FolderOpen className="size-3.5" /> : <FileCode2 className="size-3.5" />}
          <span className="font-mono font-semibold">{preview.name}</span>
          <span className="ml-auto text-[10.5px] opacity-70">최상위로</span>
        </div>
      )}
    </div>
  )
}

function cell(v: unknown): { text: string; muted?: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', muted: true }
  if (typeof v === 'object') return { text: JSON.stringify(v) }
  return { text: String(v) }
}

/**
 * Query 화면 — 저장 쿼리를 "객체"로 관리(레거시 rky-mvp 이식).
 * 좌: 저장쿼리 폴더/파일 트리(검색·새폴더/쿼리·우클릭 rename/move/delete·DnD).
 * 중앙: 선택 쿼리 편집기(이름/설명 인라인 편집 + 자동저장, {{키워드}} 파라미터, Run/Format/EXPLAIN) + 결과.
 * 우: Schema 패널(토글, 테이블/뷰·컬럼). DML 은 트랜잭션 게이트.
 *
 * **편집기·결과·스키마는 쿼리를 골랐을 때만 있다**(2026-08-12 사용자 요청). 그래서 "어디에도
 * 안 속한 미저장 편집분"이라는 상태가 없다 — 편집기에 있는 글은 언제나 저장쿼리 하나의 것이다.
 * 새로 짜려면 트리에서 "새 쿼리"를 눌러 빈 것을 만들고 시작한다.
 *
 * **두 화면이 이 하나를 쓴다**(2026-08-05). 라이브러리 소속이 연결에서 설계로 옮겨지면서
 * (`@shared/db/libraryOwner`) 설계부에도 같은 화면이 필요해졌는데, 처음엔 "준비 전용이니
 * 가벼운 걸로"라며 **줄인 화면을 따로 만들었다.** 그래서 설계부에서는 오른쪽 스키마 패널도,
 * 필터도, 끌어 옮기기도, 결과 영역도 없었다 — 시킨 것은 옮기는 일이었는데 새로 만든 것이다.
 * 지금은 한 컴포넌트가 둘을 다 그린다. **모드가 가르는 것은 딱 두 가지뿐이다:**
 *   ⑴ 라이브러리 소속(`scope`) — 설계부는 설계, 운영부는 연결
 *   ⑵ 접속이 필요한 동작 — 실행·EXPLAIN·표 미리보기·실 DB 스키마. 설계부엔 접속이 없다.
 * 나머지(트리·검색·이름 편집·자동저장·파라미터·편집기)는 두 화면이 **똑같이** 쓴다.
 */
type QueryMode = 'remote' | 'design'

/** 운영부 — 실 DB 에 붙어 돌린다. */
export function QueryView() {
  return <QueryScreen mode="remote" />
}

/** 설계부 — 같은 화면, 접속이 필요한 것만 잠근다. 여기서 짜 두면 물린 연결들이 그대로 물려받는다. */
export function DesignQueryView() {
  return <QueryScreen mode="design" />
}

function QueryScreen({ mode }: { mode: QueryMode }) {
  const isDesign = mode === 'design'
  // 설계 화면에서는 연결을 **아예 안 본다.** nav 컨텍스트에 연결이 남아 있어도(다른 화면에서 고른 것)
  // 그걸 집어 쓰면 설계부에서 실 DB 를 건드리게 된다.
  const navConn = useActiveConnection()
  const conn = isDesign ? null : navConn
  const design = useActiveDesign()

  const introTables = useRemoteStore((s) => (conn ? s.byEnv[conn.id] : undefined))
  const loadIntro = useRemoteStore((s) => s.load)
  const introError = useRemoteStore((s) => (conn ? s.error[conn.id] : null))
  const introLoading = useRemoteStore((s) => (conn ? s.loading[conn.id] : false))
  const designTables = useScopedDesignTables()
  // 오른쪽 패널이 보는 스키마 — 운영부는 실 DB 를 읽어 온 것, 설계부는 그 설계의 정의.
  // 둘 다 `TableDef[]` 라 패널은 어느 쪽인지 몰라도 된다.
  const tables = isDesign ? designTables : introTables
  const lib = useCollectionStore()

  const sql = useQueryStore((s) => s.sql)
  const setSql = useQueryStore((s) => s.setSql)
  const activeId = useQueryStore((s) => s.activeSavedQueryId)
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
  const setError = useQueryStore((s) => s.setError)

  /**
   * 저장 상태 — 머리에 실시간으로 보인다. `idle` 은 아무 말도 안 한다(열자마자 "저장됨"이라
   * 뜨면 방금 뭔가 쓴 것처럼 읽힌다). 고치는 순간 '저장 중…', 저장소에 들어가면 '저장됨'.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  /**
   * 자동저장기 — 화면이 사는 동안 하나만 둔다.
   * 저장은 스토어를 **그때그때 꺼내** 쓴다(닫힌 값에 갇히면 옛 스코프에 쓴다).
   * 실패하면 반드시 화면에 띄운다 — 조용히 삼키면 "저장이 안 된다"만 남는다.
   */
  const saverRef = useRef<SqlSaver | null>(null)
  if (!saverRef.current) {
    saverRef.current = createSqlSaver(async (id, next) => {
      try {
        await useCollectionStore.getState().saveQuerySql(id, next)
        setSaveState('saved')
      } catch (e) {
        setSaveState('idle')
        useQueryStore.getState().setError(`쿼리 저장 실패 — ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }
  const saver = saverRef.current

  const [treeFilter, setTreeFilter] = useState('')
  /** 상세 모달로 열어 둔 결과 행(0-기준). null 이면 닫혀 있다. */
  const [detailRow, setDetailRow] = useState<number | null>(null)
  const [preview, setPreview] = useState<TableRef | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string; kind: 'folder' | 'query' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropParentId, setDropParentId] = useState<string | null>(null)
  const toggleCollapse = (id: string): void => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // 아이템을 폴더로 넣은 직후 그 폴더가 접혀 있으면 펼친다 — 안 그러면 넣은 게 숨어 "사라진 것처럼" 보인다.
  const expandFolder = (id: string | null): void => { if (id) setCollapsed((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n }) }
  const [offsetLeft, setOffsetLeft] = useState(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // 라이브러리를 **어느 소속으로 볼 것인가.** 이 값 하나가 목록·만들기·이름변경을 전부 가른다.
  const scope = isDesign
    ? design
      ? { designId: design.id }
      : null
    : conn
      ? { connectionId: conn.id }
      : null
  // 지금 편집 중인 저장쿼리가 **이 화면 것인가**를 가리는 열쇠(자동저장이 남의 쿼리를 덮지 않게).
  const scopeKey = isDesign ? design?.id ?? null : conn?.id ?? null
  const dialect = isDesign ? design?.dialect : conn?.dbType

  const scopeJson = JSON.stringify(scope)
  useEffect(() => {
    if (!scope) return
    void lib.load(scope)
    // 실 DB 스키마는 접속이 있을 때만 읽는다 — 설계부는 자기 정의를 그대로 쓴다.
    if (conn) void loadIntro(conn.id, conn.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeJson])

  // 화면을 떠나거나 소속이 바뀌면 **남은 편집분을 밀어낸다.** 예전엔 타이머만 지워, 마지막 1초
  // 동안 친 글자가 어디에도 안 남았다.
  useEffect(() => {
    return () => void saver.flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeJson])

  const keywords = useMemo(() => extractKeywords(sql), [sql])
  const [kw, setKw] = useState<Record<string, string>>({})
  const missing = keywords.filter((k) => !(kw[k]?.trim()))

  if (!scope || !scopeKey) {
    return isDesign ? (
      <PlaceholderView icon={Terminal} depth="depth 3 · Design › Query" title="선택된 설계 없음" />
    ) : (
      <PlaceholderView icon={Terminal} depth="depth 3 · Remote › Query" title="선택된 연결 없음" />
    )
  }

  const flat = flattenTree(toLibNodes(lib.folders, lib.queries))
  const q = treeFilter.trim().toLowerCase()
  // 접힌 폴더의 자손은 숨긴다(검색 중엔 무시하고 매치를 다 보인다). 드래그 중 노드 자손도 제외.
  const excluded = [dragId, ...(q ? [] : [...collapsed])].filter((x): x is string => !!x)
  const visible = removeChildrenOf(flat, excluded).filter((n) => !q || n.name.toLowerCase().includes(q))
  const active = lib.queries.find((x) => x.id === activeId) ?? null
  const dragNode = dragId ? flat.find((n) => n.id === dragId) ?? null : null

  const rows = result?.rows ?? []
  const shown = rows.slice(0, MAX_ROWS)
  // 접속이 없으면 돌릴 수가 없다 — 설계부에서 잠기는 것은 **이것뿐**이다.
  const canRun = !!conn && !loading && sql.trim().length > 0 && !tx && missing.length === 0
  const effectiveSql = (): string => applyKeywords(sql, kw)

  /**
   * 트리에서 쿼리를 연다 — **저장소에서 새로 읽는다.**
   *
   * 트리에 든 사본은 낡을 수 있다(자동저장은 저장소만 고치고, 다른 창·에이전트도 고친다).
   * 사본을 그대로 실으면 낡은 글이 편집기에 오르고, 이어서 그게 저장소를 덮었다 —
   * 사용자가 겪은 "누르니 쿼리가 날아갔다"가 이것이다(2026-08-12).
   * 열기 전 밀어내기도 필수다 — 안 그러면 방금 친 글자(최대 1초)가 버려진다.
   */
  const selectQuery = async (id: string): Promise<void> => {
    await saver.flush()
    try {
      const rec = await window.rockury.savedQueries.getQuery(id)
      if (rec) {
        loadSaved(rec.id, rec.sql)
        setSaveState('idle') // 방금 연 것에 "저장됨"이 남아 있으면 안 한 일을 한 것처럼 읽힌다.
      } else {
        setError('이 쿼리는 저장소에 없습니다 — 목록을 다시 읽었습니다.')
        await lib.load(scope)
      }
    } catch (e) {
      setError(`쿼리를 열지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * 편집기 고침 — **여기서만** 저장이 예약된다. 여는 길(`selectQuery`)은 절대 안 부른다.
   * 이 화면 트리에 없는 쿼리(= 다른 소속의 것)면 안 쓴다 — 남의 작업물을 덮지 않는다.
   */
  const editSql = (next: string): void => {
    setSql(next)
    if (activeId && active) {
      setSaveState('saving')
      saver.schedule(activeId, next)
    }
  }

  /** 새 쿼리 — 빈 것을 만들고 그리로 넘어간다. */
  const newQuery = async (folderId: string | null = null): Promise<void> => {
    await saver.flush()
    const rec = await window.rockury.savedQueries.createQuery({ scope, folderId, name: 'Untitled Query', sql: '' })
    await lib.load(scope)
    loadSaved(rec.id, rec.sql)
    setSaveState('idle')
  }

  const renameNode = (kind: 'folder' | 'query', id: string, name: string): void => void lib.rename(kind, id, name)
  const patchActive = async (patch: { name?: string; description?: string }): Promise<void> => {
    if (!activeId) return
    // 이름을 고치면 트리를 다시 읽는다 — 아직 안 쓴 SQL 이 있으면 먼저 내보내야 사본이 안 낡는다.
    await saver.flush()
    await window.rockury.savedQueries.updateQuery(activeId, patch)
    await lib.load(scope)
  }

  const onDragStart = (e: DragStartEvent): void => { setDragId(String(e.active.id)); setDropParentId(null) }
  const onDragMove = (e: DragMoveEvent): void => {
    setOffsetLeft(e.delta.x)
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    // 아이템 밖(빈 배경/루트존)이면 최상위(null), 아니면 투영된 부모 폴더.
    setDropParentId(over && over !== ROOT_ZONE ? getProjection(visible, a, over, Math.round(e.delta.x / INDENT)).parentId : null)
  }
  const onDragEnd = (e: DragEndEvent): void => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setDragId(null)
    setOffsetLeft(0)
    setDropParentId(null)
    if (!over || over === ROOT_ZONE) {
      // 빈 배경/루트존에 드롭 → 최상위(root) 맨 끝으로 이동
      const activeNode = flat.find((n) => n.id === a)
      if (activeNode) void lib.applyReorder([...flat.filter((n) => n.id !== a).map((n) => ({ id: n.id, kind: n.kind, parentId: n.parentId })), { id: a, kind: activeNode.kind, parentId: null }])
      return
    }
    const proj = getProjection(visible, a, over, Math.round(offsetLeft / INDENT))
    const ids = visible.map((n) => n.id)
    const from = ids.indexOf(a)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...visible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    expandFolder(proj.parentId)
    void lib.applyReorder(reordered.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === a ? proj.parentId : n.parentId })))
  }

  const moveTo = (id: string, kind: 'folder' | 'query', parentId: string | null): void => {
    expandFolder(parentId)
    void lib.applyReorder(flat.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === id ? parentId : n.parentId })))
    setCtx(null)
    void id
    void kind
  }

  return (
    <div className="h-full min-h-0" onClick={() => ctx && setCtx(null)}>
      <WorkspacePanels
        // 패널 폭 기억은 화면마다 따로 — 한 열쇠를 나눠 쓰면 설계부에서 줄인 폭이 운영부까지 따라간다.
        autoSaveId={isDesign ? 'db.design.query' : 'db.console.query'}
        collapsible
        sidebarTitle="Queries"
        sidebarActions={
          <>
            <button type="button" title="새 폴더" onClick={() => void lib.addFolder('New Folder')} className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-strong hover:text-fg"><FolderPlus className="size-3.5" /></button>
            <button type="button" title="새 쿼리" onClick={() => void newQuery()} className="flex size-6 items-center justify-center rounded text-muted hover:bg-panel-strong hover:text-fg"><FilePlus2 className="size-3.5" /></button>
          </>
        }
        sidebar={
          <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-2 py-2">
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
                  collapsed={collapsed.has(n.id)}
                  dropTarget={dragId != null && n.id !== dragId && n.kind === 'folder' && n.id === dropParentId}
                  onSelect={() => n.kind === 'query' && void selectQuery(n.id)}
                  onToggleCollapse={() => toggleCollapse(n.id)}
                  onEditStart={() => setEditingId(n.id)}
                  onEditEnd={() => setEditingId(null)}
                  onRename={(name) => renameNode(n.kind, n.id, name)}
                  onContext={(x, y) => setCtx({ x, y, id: n.id, kind: n.kind })}
                  onDelete={() => void lib.remove(n.kind, n.id)}
                />
              ))}
            </SortableContext>
            <RootDropZone active={dragId != null} preview={dragNode ? { name: dragNode.name, isFolder: dragNode.kind === 'folder' } : null} />
            {/* 드래그 미리보기 — 커서를 따라오는 또렷한 클론(놓일 깊이만큼 들여쓰기) */}
            <DragOverlay dropAnimation={null}>
              {dragNode && (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-accent/60 bg-canvas px-2 py-1 text-[12px] shadow-lg">
                  {dragNode.kind === 'folder' ? <FolderOpen className="size-3.5 text-amber-500" /> : <FileCode2 className="size-3.5 opacity-60" />}
                  <span className="font-mono font-semibold text-fg">{dragNode.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
          {flat.length === 0 && <div className="px-4 py-2 text-[11.5px] italic text-muted">저장된 쿼리 없음</div>}
        </div>
          </div>
        }
        // 스키마 패널도 편집기와 함께 뜬다 — 고른 쿼리가 없으면 이름을 눌러도 넣을 자리가 없다.
        rightTitle={active ? 'Schema' : undefined}
        rightPanel={
          active ? (
            <SchemaPanel
              tables={tables ?? []}
              onInsert={(name) => editSql(sql + (sql && !sql.endsWith(' ') ? ' ' : '') + name)}
              // 표 미리보기는 실제로 SELECT 를 날린다 — 접속이 없는 설계부에선 단추 자체를 안 단다.
              onPreview={conn ? (t) => setPreview(t) : undefined}
            />
          ) : undefined
        }
      >
      {/* 중앙: 편집기 — **쿼리를 골랐을 때만** 있다(아래 `active ? … : 빈 상태`). */}
      {active ? (
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-5 py-2.5">
          <div className="min-w-0 flex-1">
            {/* 이름이 바뀌면 열쇠도 바뀌어야 한다 — 안 그러면(id 만 열쇠면) 트리에서 이름을
                고쳐도 이 칸엔 옛 이름이 그대로 남는다(uncontrolled 라 defaultValue 가 안 먹는다). */}
            <input
              key={`${active.id}:${active.name}`}
              defaultValue={active.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== active.name && void patchActive({ name: e.target.value.trim() })}
              className="w-full max-w-md bg-transparent text-[15px] font-bold text-fg outline-none"
            />
            <input
              key={`${active.id}:desc:${active.description}`}
              defaultValue={active.description}
              onBlur={(e) => e.target.value !== active.description && void patchActive({ description: e.target.value })}
              placeholder="Add description..."
              className="mt-0.5 w-full max-w-md bg-transparent text-[12px] text-muted outline-none"
            />
          </div>
          {/* 실시간 저장 상태 — 아무 일도 없을 땐(idle) 자리를 비운다. */}
          {saveState !== 'idle' && (
            <span
              data-save-state={saveState}
              className={cn('shrink-0 pt-1 text-[11px]', saveState === 'saving' ? 'text-muted' : 'text-success')}
            >
              {saveState === 'saving' ? '저장 중…' : '저장됨'}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-1.5 text-[12px]">
          <span className="font-semibold text-muted">SQL Editor</span>
          <div className="flex items-center gap-1.5">
            {/* 접속이 없으면 왜 못 돌리는지 이 자리에서 말한다 — 눌리지 않는 단추만 두면 고장으로 읽힌다. */}
            <span className="mr-1 text-[10px] text-muted">{conn ? '⌘+Enter to run' : '실행은 Remote 에서'}</span>
            <Button size="sm" variant="outline" disabled={!sql.trim()} title="SQL 정형화" onClick={() => dialect && editSql(formatSql(sql, dialect))}><WandSparkles /></Button>
            <Button size="sm" variant="outline" disabled={!conn || !sql.trim() || explaining || loading || missing.length > 0} title={conn ? '실행 계획(EXPLAIN)' : '접속이 있어야 볼 수 있습니다'} onClick={() => conn && void runExplain(conn.id, effectiveSql())}>
              {explaining ? <Loader2 className="animate-spin" /> : <Route />}
            </Button>
            <Button size="sm" disabled={!canRun} title={conn ? undefined : '접속이 있어야 돌릴 수 있습니다'} onClick={() => conn && void run(conn.id, effectiveSql())}>
              {loading ? <Loader2 className="animate-spin" /> : <Play />} Run
            </Button>
          </div>
        </div>

        <div className="h-44 shrink-0 overflow-auto border-b border-line px-2 py-1">
          <SqlEditor
            value={sql}
            onChange={editSql}
            onRun={() => canRun && conn && void run(conn.id, effectiveSql())}
            schema={buildSchemaMap(tables ?? [])}
            dialect={dialect}
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
        {/* 연결이 안 되면 Run 도 스키마 패널도 안 된다 — 쓰기 전에 알린다(예전엔 아무 말이 없었다). */}
        {conn && introError && (
          <ConnectionError
            variant="inline"
            error={introError}
            retrying={introLoading}
            onRetry={() => void loadIntro(conn.id, conn.id, true)}
          />
        )}
        {explain && dialect && <ExplainPanel explain={explain} dialect={dialect} />}
        <ErrorBar error={error} onDismiss={dismissError} />

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
                    // 칸이 잘려 긴 값은 표에서 못 읽는다 — 누르면 상세 모달이 자르지 않고 펴 보인다.
                    <tr
                      key={i}
                      data-result-row={i}
                      onClick={() => setDetailRow(i)}
                      className="cursor-pointer hover:bg-panel/60"
                    >
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
                <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => downloadText('query-result.csv', toCsv(result.columns, rows), 'text/csv')}><Download className="size-3" /> CSV</button>
                <button type="button" className="flex items-center gap-1 hover:text-accent" onClick={() => downloadText('query-result.json', toJson(rows), 'application/json')}><Download className="size-3" /> JSON</button>
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
      ) : (
        // 빈 상태에도 오류 줄은 둔다 — 쿼리를 여는 데 실패했다면 그 말이 여기 떠야 한다.
        <div className="flex h-full min-w-0 flex-col">
          <ErrorBar error={error} onDismiss={dismissError} />
          <PlaceholderView className="flex-1" icon={FileCode2} depth={isDesign ? 'depth 3 · Design › Query' : 'depth 3 · Remote › Query'} title="선택된 쿼리 없음" />
        </div>
      )}

      </WorkspacePanels>

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctx && (
        <TreeContextMenu
          x={ctx.x}
          y={ctx.y}
          targets={moveTargets(toLibNodes(lib.folders, lib.queries), ctx.id)}
          onRename={() => setEditingId(ctx.id)}
          onMove={(parentId) => moveTo(ctx.id, ctx.kind, parentId)}
          onDelete={() => void lib.remove(ctx.kind, ctx.id)}
          onClose={() => setCtx(null)}
        />
      )}

      {preview && conn && <TablePreviewModal connectionId={conn.id} dialect={conn.dbType} table={preview} onClose={() => setPreview(null)} />}

      {detailRow != null && result && (
        <RowDetailDialog
          columns={result.columns}
          rows={shown}
          index={detailRow}
          onIndexChange={setDetailRow}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  )
}

/** 실패 한 줄 — 편집기가 있을 때도 없을 때도 같은 자리에서 말한다(조용히 삼키지 않는다). */
function ErrorBar({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
      <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono">{error}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 opacity-70 hover:opacity-100"><X className="size-3.5" /></button>
    </div>
  )
}

/** 트리 한 행 — 폴더(펼침/닫힘 아이콘)/쿼리. 클릭 선택·폴더접기, 더블클릭 이름변경, 우클릭 메뉴, DnD. */
function QueryTreeRow({ node, active, editing, collapsed, dropTarget, onSelect, onToggleCollapse, onEditStart, onEditEnd, onRename, onContext, onDelete }: { node: FlatNode; active: boolean; editing: boolean; collapsed: boolean; dropTarget: boolean; onSelect: () => void; onToggleCollapse: () => void; onEditStart: () => void; onEditEnd: () => void; onRename: (name: string) => void; onContext: (x: number, y: number) => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const isFolder = node.kind === 'folder'
  // 드래그 중인 원본 행은 숨기고(DragOverlay 클론이 미리보기), 대상 폴더 행은 강조한다.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY) }}
      className={cn('group/row flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-30', active && 'bg-accent-soft/60', dropTarget && 'rounded bg-accent/20 ring-1 ring-accent')}
    >
      <span {...attributes} {...listeners} onClick={isFolder ? onToggleCollapse : undefined} className="cursor-grab text-muted" title={isFolder ? '클릭: 펼치기/접기 · 드래그: 이동' : '드래그로 이동'}>
        {isFolder ? (collapsed ? <Folder className="size-3.5 text-amber-500" /> : <FolderOpen className="size-3.5 text-amber-500" />) : <FileCode2 className="size-3.5 opacity-60" />}
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
          onClick={isFolder ? onToggleCollapse : onSelect}
          onDoubleClick={onEditStart}
          className={cn('min-w-0 flex-1 truncate text-left font-mono', isFolder ? 'font-semibold text-fg' : active ? 'font-semibold text-accent' : 'text-fg')}
          title={node.kind === 'query' ? node.sql : node.name}
        >
          {node.name}
        </button>
      )}
      {!editing && (
        <>
          <button type="button" onClick={onEditStart} className="text-muted opacity-0 hover:text-accent group-hover/row:opacity-100" title="이름 변경"><Pencil className="size-3.5" /></button>
          <button type="button" onClick={onDelete} className="text-muted opacity-0 hover:text-destructive group-hover/row:opacity-100" title="삭제"><Trash2 className="size-3.5" /></button>
        </>
      )}
    </div>
  )
}

/** 스키마 사이드 패널 — 테이블/컬럼 트리 + 검색 + 클릭 삽입 + 테이블 미리보기. */
function SchemaPanel({ tables, onInsert, onPreview }: { tables: TableDef[]; onInsert: (name: string) => void; onPreview?: (table: TableRef) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const query = q.trim().toLowerCase()
  const filtered = tables.filter((t) => !query || t.name.toLowerCase().includes(query) || t.columns.some((c) => c.name.toLowerCase().includes(query)))
  return (
    <div className="flex h-full min-h-0 flex-col">
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
                {onPreview && <button type="button" onClick={() => onPreview({ schema: t.schema, name: t.name })} className="text-muted hover:text-accent" title="미리보기(SELECT * LIMIT 50)"><Table2 className="size-3" /></button>}
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
    </div>
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
function TablePreviewModal({ connectionId, dialect, table, onClose }: { connectionId: string; dialect: string; table: TableRef; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef(table)
  useEffect(() => {
    void (async () => {
      try {
        // 스키마까지 한정한다 — 이름만 쓰면 연결의 기본 스키마에서 찾아 없다고 하거나 남의 표를 읽는다.
        const target = quoteTable(dialect as SqlDialect, ref.current)
        const r = await window.rockury.query.run(connectionId, `SELECT * FROM ${target} LIMIT 50`)
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
        <DialogHeader><DialogTitle>미리보기 · {qualifiedName(table)} (상위 50행)</DialogTitle></DialogHeader>
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
