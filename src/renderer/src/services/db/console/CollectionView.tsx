import { useEffect, useState } from 'react'
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
import { Ban, ExternalLink, Eye, FileCode2, FilePlus2, Folder, FolderOpen, FolderPlus, Layers, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { useActiveConnection } from '../connections/store'
import { type QueryResult } from './query/store'
import { flattenTree, getProjection, moveTargets, removeChildrenOf, type FlatNode } from './collection/tree'
import { toCollLibNodes, toLibNodes, useCollectionStore, type ItemStatus } from './collection/store'
import { TreeContextMenu } from './collection/TreeMenu'

const INDENT = 14
const ROOT_ZONE = 'c-root-zone'

/** 컬렉션 트리 하단 빈 영역 = 최상위(root) 드롭존. 놓일 자리를 고스트 행으로 미리보기. */
function RootDropZone({ active, preview }: { active: boolean; preview: { name: string; isFolder: boolean } | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_ZONE })
  return (
    <div ref={setNodeRef} className="min-h-[80px] w-full">
      {active && isOver && preview && (
        <div className="mx-1 mt-0.5 flex items-center gap-1.5 rounded border border-dashed border-accent bg-accent-soft/30 py-1 pl-2 pr-3 text-[12px] text-accent">
          {preview.isFolder ? <FolderOpen className="size-3.5" /> : <Layers className="size-3.5" />}
          <span className="font-semibold">{preview.name}</span>
          <span className="ml-auto text-[10.5px] opacity-70">최상위로</span>
        </div>
      )}
    </div>
  )
}

const STATUS_DOT: Record<ItemStatus, string> = {
  pending: 'bg-muted/40',
  running: 'bg-info',
  ok: 'bg-success',
  error: 'bg-destructive',
  skipped: 'bg-muted/40'
}

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && 'opacity-50')} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

/** 컬렉션 트리 행 — 폴더(펼침/닫힘 아이콘)/컬렉션(리프). 클릭 선택·폴더접기, 더블클릭 이름변경, 삭제, DnD. */
function CollTreeRow({ node, active, editing, collapsed, dropTarget, onSelect, onToggleCollapse, onEditStart, onEditEnd, onRename, onDelete, onContext }: {
  node: FlatNode; active: boolean; editing: boolean; collapsed: boolean; dropTarget: boolean; onSelect: () => void; onToggleCollapse: () => void; onEditStart: () => void; onEditEnd: () => void; onRename: (name: string) => void; onDelete: () => void; onContext: (x: number, y: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const isFolder = node.kind === 'folder'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY) }}
      className={cn('group/row flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-30', active && 'bg-accent-soft/60', dropTarget && 'rounded bg-accent/20 ring-1 ring-accent')}
    >
      <span {...attributes} {...listeners} onClick={isFolder ? onToggleCollapse : undefined} className="cursor-grab text-muted" title={isFolder ? '클릭: 펼치기/접기 · 드래그: 이동' : '드래그로 이동'}>
        {isFolder ? (collapsed ? <Folder className="size-3.5 text-amber-500" /> : <FolderOpen className="size-3.5 text-amber-500" />) : <Layers className="size-3.5 opacity-60" />}
      </span>
      {editing ? (
        <Input autoFocus defaultValue={node.name} onBlur={(e) => { onEditEnd(); if (e.target.value.trim() && e.target.value !== node.name) onRename(e.target.value.trim()) }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-6 w-40 text-[12px]" />
      ) : (
        <button type="button" onClick={isFolder ? onToggleCollapse : onSelect} onDoubleClick={onEditStart} className={cn('min-w-0 flex-1 truncate text-left', isFolder ? 'font-semibold text-fg' : active ? 'font-semibold text-accent' : 'text-fg')}>
          {node.name}
        </button>
      )}
      {!editing && (
        <button type="button" onClick={onEditStart} className="text-muted opacity-0 hover:text-accent group-hover/row:opacity-100" title="이름 변경"><Pencil className="size-3.5" /></button>
      )}
      <button type="button" onClick={onDelete} className="text-muted opacity-0 hover:text-destructive group-hover/row:opacity-100" title="삭제"><Trash2 className="size-3.5" /></button>
    </div>
  )
}

/**
 * Console › Collection(운영부 · depth 3) — 레거시 rky-mvp 구조 이식.
 * 좌: 컬렉션 폴더/파일 트리(검색·새폴더/컬렉션·rename·삭제·DnD).
 * 중앙: 선택 컬렉션의 순서 있는 아이템(Run All·개별 실행·편집·제거·SELECT 결과) — 하나의 원자적 트랜잭션.
 * 우: QUERIES 트리 — 저장쿼리를 클릭해 컬렉션에 참조 추가.
 */
export function CollectionView() {
  const conn = useActiveConnection()
  const st = useCollectionStore()
  const [offsetLeft, setOffsetLeft] = useState(0)
  const [dragId, setDragId] = useState<string | null>(null)
  const [colDropParentId, setColDropParentId] = useState<string | null>(null)
  const [colFilter, setColFilter] = useState('')
  const [qFilter, setQFilter] = useState('')
  const [editingColNode, setEditingColNode] = useState<string | null>(null)
  const [colCtx, setColCtx] = useState<{ x: number; y: number; id: string; kind: 'folder' | 'collection' } | null>(null)
  const [colCollapsed, setColCollapsed] = useState<Set<string>>(new Set())
  const [qCollapsed, setQCollapsed] = useState<Set<string>>(new Set())
  const [dropActive, setDropActive] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', sql: '' })
  const toggle = (set: (fn: (s: Set<string>) => Set<string>) => void, id: string): void => set((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // 아이템을 폴더로 넣은 직후 그 폴더가 접혀 있으면 펼친다 — 안 그러면 넣은 게 숨어 "사라진 것처럼" 보인다.
  const expandColFolder = (id: string | null): void => { if (id) setColCollapsed((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n }) }
  const [editItem, setEditItem] = useState<{ id: string; name: string; sql: string } | null>(null)
  // 결과를 인라인으로 펼친 아이템 id 집합(각 쿼리 결과를 그 자리에서 그리드로 본다).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (conn) void st.load(conn.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  if (!conn) {
    return <PlaceholderView icon={Layers} depth="depth 3 · Console › Collection" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 컬렉션을 관리할 수 있습니다." />
  }

  const colFlat = flattenTree(toCollLibNodes(st.collectionFolders, st.collections))
  const colQ = colFilter.trim().toLowerCase()
  const colExcl = [dragId, ...(colQ ? [] : [...colCollapsed])].filter((x): x is string => !!x)
  const colVisible = removeChildrenOf(colFlat, colExcl).filter((n) => !colQ || n.name.toLowerCase().includes(colQ))
  const activeCollection = st.collections.find((c) => c.id === st.activeCollectionId) ?? null
  const colDragNode = dragId ? colFlat.find((n) => n.id === dragId) ?? null : null

  const qQ = qFilter.trim().toLowerCase()
  const qFlatAll = flattenTree(toLibNodes(st.folders, st.queries))
  const qFlat = removeChildrenOf(qFlatAll, qQ ? [] : [...qCollapsed]).filter((n) => !qQ || n.name.toLowerCase().includes(qQ))

  const onDragStart = (e: DragStartEvent): void => { setDragId(String(e.active.id)); setColDropParentId(null) }
  const onDragMove = (e: DragMoveEvent): void => {
    setOffsetLeft(e.delta.x)
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setColDropParentId(over && over !== ROOT_ZONE ? getProjection(colVisible, a, over, Math.round(e.delta.x / INDENT)).parentId : null)
  }
  const onColDragEnd = (e: DragEndEvent): void => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setDragId(null)
    setOffsetLeft(0)
    setColDropParentId(null)
    if (!over || over === ROOT_ZONE) {
      // 빈 배경 드롭 → 최상위(root) 맨 끝으로
      const activeNode = colFlat.find((n) => n.id === a)
      if (activeNode) void st.applyCollectionReorder([
        ...colFlat.filter((n) => n.id !== a).map((n) => ({ id: n.id, kind: n.kind === 'folder' ? 'folder' as const : 'collection' as const, parentId: n.parentId })),
        { id: a, kind: activeNode.kind === 'folder' ? 'folder' as const : 'collection' as const, parentId: null }
      ])
      return
    }
    const proj = getProjection(colVisible, a, over, Math.round(offsetLeft / INDENT))
    const ids = colVisible.map((n) => n.id)
    const from = ids.indexOf(a)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...colVisible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    expandColFolder(proj.parentId)
    void st.applyCollectionReorder(
      reordered.map((n) => ({ id: n.id, kind: n.kind === 'folder' ? 'folder' : 'collection', parentId: n.id === a ? proj.parentId : n.parentId }))
    )
  }

  // 컨텍스트 메뉴 "이동" — 노드의 부모를 targetId 로 바꾼다(폴더면 자기·자손은 moveTargets 에서 이미 제외됨).
  const moveCollNode = (id: string, parentId: string | null): void => {
    expandColFolder(parentId)
    void st.applyCollectionReorder(
      colFlat.map((n) => ({ id: n.id, kind: n.kind === 'folder' ? ('folder' as const) : ('collection' as const), parentId: n.id === id ? parentId : n.parentId }))
    )
    setColCtx(null)
  }

  const onItemsDragEnd = (e: DragEndEvent): void => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over || a === over) return
    const ids = st.items.map((i) => i.id)
    const from = ids.indexOf(a)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void st.reorderItems(ids)
  }

  return (
    <div className="flex h-full min-h-0" onClick={() => colCtx && setColCtx(null)}>
      {/* 좌: 컬렉션 트리 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>Collections</span>
          <div className="flex items-center gap-1">
            <button type="button" title="새 폴더" onClick={() => void st.addCollectionFolder('New Folder')} className="text-muted hover:text-fg"><FolderPlus className="size-3.5" /></button>
            <button type="button" title="새 컬렉션" onClick={() => void st.addCollection('Untitled Collection')} className="text-muted hover:text-fg"><FilePlus2 className="size-3.5" /></button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-b border-line px-2 pb-2">
          <Search className="size-3.5 text-muted" />
          <input value={colFilter} onChange={(e) => setColFilter(e.target.value)} placeholder="Filter collections..." className="w-full bg-transparent text-[12px] outline-none" />
        </div>
        <div className={cn('min-h-0 flex-1 overflow-auto py-1', dragId && colDropParentId === null && 'bg-accent-soft/20 ring-2 ring-inset ring-accent/40')}>
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onColDragEnd}>
            <SortableContext items={colVisible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {colVisible.map((n) => (
                <CollTreeRow
                  key={n.id}
                  node={n}
                  active={n.kind !== 'folder' && n.id === st.activeCollectionId}
                  editing={editingColNode === n.id}
                  collapsed={colCollapsed.has(n.id)}
                  dropTarget={dragId != null && n.id !== dragId && n.kind === 'folder' && n.id === colDropParentId}
                  onSelect={() => n.kind !== 'folder' && void st.selectCollection(n.id)}
                  onToggleCollapse={() => toggle(setColCollapsed, n.id)}
                  onEditStart={() => setEditingColNode(n.id)}
                  onEditEnd={() => setEditingColNode(null)}
                  onRename={(name) => (n.kind === 'folder' ? st.renameCollectionFolder(n.id, name) : st.renameCollection(n.id, name))}
                  onDelete={() => (n.kind === 'folder' ? st.removeCollectionFolder(n.id) : st.removeCollection(n.id))}
                  onContext={(x, y) => setColCtx({ x, y, id: n.id, kind: n.kind === 'folder' ? 'folder' : 'collection' })}
                />
              ))}
            </SortableContext>
            <RootDropZone active={dragId != null} preview={colDragNode ? { name: colDragNode.name, isFolder: colDragNode.kind === 'folder' } : null} />
            <DragOverlay dropAnimation={null}>
              {colDragNode && (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-accent/60 bg-canvas px-2 py-1 text-[12px] shadow-lg">
                  {colDragNode.kind === 'folder' ? <FolderOpen className="size-3.5 text-amber-500" /> : <Layers className="size-3.5 opacity-60" />}
                  <span className="font-semibold text-fg">{colDragNode.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
          {colFlat.length === 0 && <div className="px-4 py-2 text-[11.5px] text-muted">컬렉션이 없어요. + 로 만드세요.</div>}
        </div>
      </aside>

      {/* 중앙: 활성 컬렉션 아이템 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!activeCollection ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">컬렉션을 선택하거나 새로 만드세요</div>
        ) : (
          <>
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <input
                  key={activeCollection.id}
                  defaultValue={activeCollection.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== activeCollection.name && void st.updateCollection(activeCollection.id, { name: e.target.value.trim() })}
                  className="w-full max-w-md bg-transparent text-[15px] font-bold text-fg outline-none"
                />
                <input
                  key={`${activeCollection.id}-desc`}
                  defaultValue={activeCollection.description}
                  onBlur={(e) => e.target.value !== activeCollection.description && void st.updateCollection(activeCollection.id, { description: e.target.value })}
                  placeholder="설명 추가..."
                  className="mt-0.5 w-full max-w-md bg-transparent text-[12px] text-muted outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                {st.running ? (
                  <Button size="sm" variant="outline" onClick={() => void st.abort()}><Ban /> 중단</Button>
                ) : st.error && !st.tx ? (
                  <Button size="sm" variant="outline" onClick={() => void st.retry()}><RotateCcw /> 재시도</Button>
                ) : !st.tx ? (
                  <Button size="sm" disabled={st.items.length === 0} onClick={() => void st.runAll()}><Play /> Run All ({st.items.length})</Button>
                ) : null}
              </div>
            </div>

            {st.tx && (
              <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1">실행됨 · 영향 <b className="font-mono">{st.tx.affected}</b>행 · 아직 커밋되지 않았습니다 <span className="text-muted">(하나의 트랜잭션 — 커밋 전까지 원자적)</span></span>
                <Button size="sm" variant="ghost" onClick={() => void st.rollback()}>롤백</Button>
                <Button size="sm" onClick={() => void st.confirm()}>커밋</Button>
              </div>
            )}
            {!st.tx && st.info && (
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/60 px-4 py-2 text-[12px] text-muted">
                <Eye className="size-3.5 shrink-0 text-success" />
                <span className="min-w-0 flex-1">{st.info}</span>
              </div>
            )}
            {st.error && (
              <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">{st.error} <button type="button" className="ml-2 opacity-70" onClick={st.dismissError}>✕</button></div>
            )}

            <div
              data-drop="collection-items"
              className={cn('min-h-0 flex-1 overflow-auto p-3', dropActive && 'bg-accent-soft/20 ring-2 ring-inset ring-accent')}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragEnter={() => setDropActive(true)}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false) }}
              onDrop={(e) => { e.preventDefault(); setDropActive(false); const id = e.dataTransfer.getData('text/query-id'); if (id) void st.addReference(id) }}
            >
              {dropActive && <div className="mb-2 rounded border border-dashed border-accent bg-accent-soft/30 px-3 py-2 text-center text-[12px] text-accent">여기에 놓아 참조로 추가</div>}
              <DndContext sensors={sensors} onDragEnd={onItemsDragEnd}>
                <SortableContext items={st.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {st.items.map((it, idx) => {
                    const result = st.results[it.id]
                    const isOpen = expanded.has(it.id)
                    return (
                    <SortableItem key={it.id} id={it.id}>
                      <div className="group/item mb-1.5 rounded-md border border-line bg-canvas">
                        <div className="flex cursor-grab items-start gap-2 p-2">
                          <span className={cn('mt-1 size-2 shrink-0 rounded-full', STATUS_DOT[st.itemStatus[it.id] ?? 'pending'])} />
                          <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
                              {it.name || '(이름 없음)'}
                              {it.savedQueryId && <span className="flex items-center gap-0.5 rounded bg-accent-soft px-1 text-[9px] font-bold text-accent" title="라이브러리 쿼리 참조(원본 수정 시 반영)"><ExternalLink className="size-2.5" /> 참조</span>}
                              {result && <span className="rounded bg-panel-strong px-1 text-[9px] font-mono text-muted">{result.rowCount}행</span>}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted" title={it.sql}>{it.sql || '(empty)'}</div>
                          </div>
                          <button type="button" onClick={() => void st.runOne(it.id)} onPointerDown={(e) => e.stopPropagation()} disabled={st.running} className="text-muted hover:text-accent disabled:opacity-40" title="이 아이템만 실행(열린 트랜잭션에 이어붙임 · 개별 커밋 안 함)"><Play className="size-3.5" /></button>
                          {result && <button type="button" onClick={() => toggle(setExpanded, it.id)} onPointerDown={(e) => e.stopPropagation()} className={cn('hover:text-accent', isOpen ? 'text-accent' : 'text-muted')} title={isOpen ? '결과 접기' : '결과 펼치기'}><Eye className="size-3.5" /></button>}
                          {!it.savedQueryId && <button type="button" onClick={() => setEditItem({ id: it.id, name: it.name, sql: it.sql })} onPointerDown={(e) => e.stopPropagation()} className="text-muted opacity-0 hover:text-accent group-hover/item:opacity-100" title="편집"><Pencil className="size-3.5" /></button>}
                          <button type="button" onClick={() => void st.removeItem(it.id)} onPointerDown={(e) => e.stopPropagation()} className="text-muted hover:text-destructive" title="제거"><Trash2 className="size-3.5" /></button>
                        </div>
                        {isOpen && result && <InlineResult result={result} />}
                      </div>
                    </SortableItem>
                    )
                  })}
                </SortableContext>
              </DndContext>
              {st.items.length === 0 && <div className="py-4 text-center text-[12px] text-muted">아이템이 없어요. 오른쪽 QUERIES 에서 클릭해 추가하거나 아래에서 직접 입력하세요.</div>}
            </div>

            <form className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (!newItem.sql.trim()) return; void st.addItem(newItem.name.trim() || '쿼리', newItem.sql.trim()); setNewItem({ name: '', sql: '' }) }}>
              <Input value={newItem.name} onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))} placeholder="즉석 이름" className="h-8 w-28 text-[12px]" />
              <Input value={newItem.sql} onChange={(e) => setNewItem((v) => ({ ...v, sql: e.target.value }))} placeholder="즉석 SELECT …" className="h-8 flex-1 font-mono text-[12px]" />
              <Button type="submit" size="sm" disabled={!newItem.sql.trim()}>추가</Button>
            </form>
          </>
        )}
      </div>

      {/* 우: QUERIES(저장쿼리 트리) — 클릭해 컬렉션에 참조 추가 */}
      <aside className="flex w-60 shrink-0 flex-col border-l border-line">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Queries</div>
        <div className="flex items-center gap-1.5 border-b border-line px-2 pb-2">
          <Search className="size-3.5 text-muted" />
          <input value={qFilter} onChange={(e) => setQFilter(e.target.value)} placeholder="Filter..." className="w-full bg-transparent text-[12px] outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {qFlat.map((n) => {
            const isFolder = n.kind === 'folder'
            const isCollapsed = qCollapsed.has(n.id)
            return (
              <div
                key={n.id}
                draggable={!isFolder}
                onDragStart={!isFolder ? (e) => { e.dataTransfer.setData('text/query-id', n.id); e.dataTransfer.effectAllowed = 'copy' } : undefined}
                style={{ paddingLeft: n.depth * INDENT + 8 }}
                className={cn('group/q flex items-center gap-1.5 py-1 pr-2 text-[12px]', !isFolder && 'cursor-grab')}
                title={isFolder ? undefined : '드래그해서 컬렉션에 추가 · 또는 + 클릭'}
              >
                {isFolder
                  ? <button type="button" onClick={() => toggle(setQCollapsed, n.id)} className="text-amber-500">{isCollapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}</button>
                  : <FileCode2 className="size-3.5 shrink-0 opacity-60" />}
                <span onClick={isFolder ? () => toggle(setQCollapsed, n.id) : undefined} className={cn('min-w-0 flex-1 truncate font-mono', isFolder ? 'cursor-pointer font-semibold text-fg' : 'text-muted')} title={n.kind === 'query' ? n.sql : n.name}>{n.name}</span>
                {!isFolder && activeCollection && (
                  <button type="button" title="이 컬렉션에 참조로 추가" onClick={() => void st.addReference(n.id)} className="text-muted opacity-0 hover:text-accent group-hover/q:opacity-100"><Plus className="size-3.5" /></button>
                )}
              </div>
            )
          })}
          {qFlat.length === 0 && <div className="px-3 py-2 text-[11.5px] text-muted">저장된 쿼리가 없어요. Query 탭에서 만드세요.</div>}
        </div>
      </aside>

      {/* 아이템 편집 모달 */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>아이템 편집</DialogTitle></DialogHeader>
          {editItem && (
            <div className="mt-2 flex flex-col gap-2">
              <Input value={editItem.name} onChange={(e) => setEditItem((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="이름" className="text-[12px]" />
              <textarea value={editItem.sql} onChange={(e) => setEditItem((v) => (v ? { ...v, sql: e.target.value } : v))} className="h-40 rounded border border-line bg-canvas p-2 font-mono text-[12px] outline-none" />
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditItem(null)}>취소</Button>
                <Button size="sm" onClick={() => { if (editItem) { void st.updateItem(editItem.id, { name: editItem.name, sql: editItem.sql }); setEditItem(null) } }}>저장</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {colCtx && (
        <TreeContextMenu
          x={colCtx.x}
          y={colCtx.y}
          targets={moveTargets(toCollLibNodes(st.collectionFolders, st.collections), colCtx.id)}
          onRename={() => setEditingColNode(colCtx.id)}
          onMove={(parentId) => moveCollNode(colCtx.id, parentId)}
          onDelete={() => (colCtx.kind === 'folder' ? st.removeCollectionFolder(colCtx.id) : st.removeCollection(colCtx.id))}
          onClose={() => setColCtx(null)}
        />
      )}
    </div>
  )
}

/**
 * 인라인 결과 그리드(읽기 전용) — 아이템 카드 아래에 펼쳐진다.
 * 순서 있는 컬렉션에서 각 쿼리 결과를 그 자리에서·여러 개 동시에 비교할 수 있게 모달 대신 인라인.
 * onPointerDown 전파를 막아 결과 영역 조작이 카드 드래그를 시작시키지 않게 한다.
 */
const INLINE_MAX_ROWS = 100
function InlineResult({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return (
      <div className="border-t border-line px-3 py-2 text-[11.5px] text-muted" onPointerDown={(e) => e.stopPropagation()}>
        결과 집합 없음 · {typeof result.affectedRows === 'number' ? `${result.affectedRows}행 영향` : '0행'}
      </div>
    )
  }
  const shown = result.rows.slice(0, INLINE_MAX_ROWS)
  return (
    <div className="cursor-default border-t border-line" onPointerDown={(e) => e.stopPropagation()}>
      <div className="max-h-64 overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              {result.columns.map((c) => (
                <th key={c} className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-panel px-2 py-1 text-left font-mono font-semibold text-fg">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="hover:bg-panel/60">
                {result.columns.map((c) => {
                  const v = row[c]
                  const isNull = v === null || v === undefined
                  const text = isNull ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)
                  return <td key={c} className={cn('max-w-[240px] truncate border-b border-line/50 px-2 py-1 font-mono', isNull ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 text-[11px] text-muted">
        {result.rowCount}행{result.rows.length > INLINE_MAX_ROWS && ` · 상위 ${INLINE_MAX_ROWS}행만 표시`}{typeof result.executionTimeMs === 'number' && ` · ${result.executionTimeMs}ms`}
      </div>
    </div>
  )
}
