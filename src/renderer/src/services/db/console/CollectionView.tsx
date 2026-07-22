import { useEffect, useState } from 'react'
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
import { Ban, ChevronDown, ExternalLink, Eye, FilePlus2, FolderPlus, Layers, Loader2, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { useActiveConnection } from '../connections/store'
import { type QueryResult } from './query/store'
import { flattenTree, getProjection, removeChildrenOf, type FlatNode } from './collection/tree'
import { toCollLibNodes, toLibNodes, useCollectionStore, type ItemStatus } from './collection/store'

const INDENT = 14

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

/** 컬렉션 트리 행 — 폴더/컬렉션(리프). 클릭 선택, 더블클릭 이름변경, 삭제, DnD. */
function CollTreeRow({ node, active, editing, onSelect, onEditStart, onEditEnd, onRename, onDelete }: {
  node: FlatNode; active: boolean; editing: boolean; onSelect: () => void; onEditStart: () => void; onEditEnd: () => void; onRename: (name: string) => void; onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const isFolder = node.kind === 'folder'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      className={cn('group/row flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-50', active && 'bg-accent-soft/60')}
    >
      <span {...attributes} {...listeners} className="cursor-grab text-muted">
        {isFolder ? <ChevronDown className="size-3.5" /> : <Layers className="size-3.5 opacity-60" />}
      </span>
      {editing ? (
        <Input autoFocus defaultValue={node.name} onBlur={(e) => { onEditEnd(); if (e.target.value.trim() && e.target.value !== node.name) onRename(e.target.value.trim()) }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-6 w-40 text-[12px]" />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={onEditStart} className={cn('min-w-0 flex-1 truncate text-left', isFolder ? 'font-semibold text-fg' : active ? 'font-semibold text-accent' : 'text-fg')}>
          {node.name}
        </button>
      )}
      <button type="button" onClick={onDelete} className="text-muted opacity-0 hover:text-destructive group-hover/row:opacity-100"><Trash2 className="size-3.5" /></button>
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
  const [colFilter, setColFilter] = useState('')
  const [qFilter, setQFilter] = useState('')
  const [editingColNode, setEditingColNode] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({ name: '', sql: '' })
  const [editItem, setEditItem] = useState<{ id: string; name: string; sql: string } | null>(null)
  const [resultView, setResultView] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (conn) void st.load(conn.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  if (!conn) {
    return <PlaceholderView icon={Layers} depth="depth 3 · Console › Collection" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 컬렉션을 관리할 수 있습니다." />
  }

  const colFlat = flattenTree(toCollLibNodes(st.collectionFolders, st.collections))
  const colVisible = (dragId ? removeChildrenOf(colFlat, [dragId]) : colFlat).filter((n) => !colFilter.trim() || n.name.toLowerCase().includes(colFilter.trim().toLowerCase()))
  const activeCollection = st.collections.find((c) => c.id === st.activeCollectionId) ?? null

  const qFlat = flattenTree(toLibNodes(st.folders, st.queries)).filter((n) => !qFilter.trim() || n.name.toLowerCase().includes(qFilter.trim().toLowerCase()))

  const onDragStart = (e: DragStartEvent): void => setDragId(String(e.active.id))
  const onDragMove = (e: DragMoveEvent): void => setOffsetLeft(e.delta.x)
  const onColDragEnd = (e: DragEndEvent): void => {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setDragId(null)
    setOffsetLeft(0)
    if (!over) return
    const proj = getProjection(colVisible, a, over, Math.round(offsetLeft / INDENT))
    const ids = colVisible.map((n) => n.id)
    const from = ids.indexOf(a)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...colVisible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    void st.applyCollectionReorder(
      reordered.map((n) => ({ id: n.id, kind: n.kind === 'folder' ? 'folder' : 'collection', parentId: n.id === a ? proj.parentId : n.parentId }))
    )
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
    <div className="flex h-full min-h-0">
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
        <div className="min-h-0 flex-1 overflow-auto py-1">
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onColDragEnd}>
            <SortableContext items={colVisible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {colVisible.map((n) => (
                <CollTreeRow
                  key={n.id}
                  node={n}
                  active={n.kind !== 'folder' && n.id === st.activeCollectionId}
                  editing={editingColNode === n.id}
                  onSelect={() => n.kind !== 'folder' && void st.selectCollection(n.id)}
                  onEditStart={() => setEditingColNode(n.id)}
                  onEditEnd={() => setEditingColNode(null)}
                  onRename={(name) => (n.kind === 'folder' ? st.renameCollectionFolder(n.id, name) : st.renameCollection(n.id, name))}
                  onDelete={() => (n.kind === 'folder' ? st.removeCollectionFolder(n.id) : st.removeCollection(n.id))}
                />
              ))}
            </SortableContext>
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
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
              {editingColNode === activeCollection.id ? (
                <Input autoFocus defaultValue={activeCollection.name} onBlur={(e) => { setEditingColNode(null); if (e.target.value.trim() && e.target.value !== activeCollection.name) void st.renameCollection(activeCollection.id, e.target.value.trim()) }} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="h-7 w-64 text-[14px] font-bold" />
              ) : (
                <button type="button" onDoubleClick={() => setEditingColNode(activeCollection.id)} className="text-[15px] font-bold text-fg outline-none" title="더블클릭: 이름 변경">{activeCollection.name}</button>
              )}
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
            {st.error && (
              <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">{st.error} <button type="button" className="ml-2 opacity-70" onClick={st.dismissError}>✕</button></div>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <DndContext sensors={sensors} onDragEnd={onItemsDragEnd}>
                <SortableContext items={st.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {st.items.map((it, idx) => (
                    <SortableItem key={it.id} id={it.id}>
                      <div className="group/item mb-1.5 flex cursor-grab items-start gap-2 rounded-md border border-line bg-canvas p-2">
                        <span className={cn('mt-1 size-2 shrink-0 rounded-full', STATUS_DOT[st.itemStatus[it.id] ?? 'pending'])} />
                        <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted">{idx + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
                            {it.name || '(이름 없음)'}
                            {it.savedQueryId && <span className="flex items-center gap-0.5 rounded bg-accent-soft px-1 text-[9px] font-bold text-accent" title="라이브러리 쿼리 참조(원본 수정 시 반영)"><ExternalLink className="size-2.5" /> 참조</span>}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted" title={it.sql}>{it.sql || '(empty)'}</div>
                        </div>
                        <button type="button" onClick={() => void st.runOne(it.id)} onPointerDown={(e) => e.stopPropagation()} disabled={st.running} className="text-muted hover:text-accent disabled:opacity-40" title="이 아이템만 실행(열린 트랜잭션에 이어붙임 · 개별 커밋 안 함)"><Play className="size-3.5" /></button>
                        {st.results[it.id] && <button type="button" onClick={() => setResultView(it.id)} onPointerDown={(e) => e.stopPropagation()} className="text-muted hover:text-accent" title="결과 보기"><Eye className="size-3.5" /></button>}
                        {!it.savedQueryId && <button type="button" onClick={() => setEditItem({ id: it.id, name: it.name, sql: it.sql })} onPointerDown={(e) => e.stopPropagation()} className="text-muted opacity-0 hover:text-accent group-hover/item:opacity-100" title="편집"><Pencil className="size-3.5" /></button>}
                        <button type="button" onClick={() => void st.removeItem(it.id)} onPointerDown={(e) => e.stopPropagation()} className="text-muted hover:text-destructive" title="제거"><Trash2 className="size-3.5" /></button>
                      </div>
                    </SortableItem>
                  ))}
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
          {qFlat.map((n) => (
            <div key={n.id} style={{ paddingLeft: n.depth * INDENT + 8 }} className="group/q flex items-center gap-1.5 py-1 pr-2 text-[12px]">
              {n.kind === 'folder' ? <ChevronDown className="size-3.5 text-muted" /> : <span className="inline-block w-3.5" />}
              <span className={cn('min-w-0 flex-1 truncate font-mono', n.kind === 'folder' ? 'font-semibold text-fg' : 'text-muted')} title={n.kind === 'query' ? n.sql : n.name}>{n.name}</span>
              {n.kind === 'query' && activeCollection && (
                <button type="button" title="이 컬렉션에 참조로 추가" onClick={() => void st.addReference(n.id)} className="text-muted opacity-0 hover:text-accent group-hover/q:opacity-100"><Plus className="size-3.5" /></button>
              )}
            </div>
          ))}
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

      <ResultModal open={!!resultView} title={st.items.find((i) => i.id === resultView)?.name ?? ''} result={resultView ? st.results[resultView] : undefined} onClose={() => setResultView(null)} />
    </div>
  )
}

/** 결과 그리드 모달(읽기 전용). */
function ResultModal({ open, title, result, error, onClose }: { open: boolean; title: string; result?: QueryResult; error?: string; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>결과 · {title}</DialogTitle></DialogHeader>
        {error ? (
          <div className="rounded bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>
        ) : !result ? (
          <div className="py-6 text-center text-[12px] text-muted"><Loader2 className="mx-auto size-4 animate-spin" /></div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel"><tr>{result.columns.map((c) => <th key={c} className="border-b border-line px-2 py-1 text-left font-mono">{c}</th>)}</tr></thead>
              <tbody>
                {result.rows.slice(0, 500).map((row, i) => (
                  <tr key={i} className="hover:bg-panel/60">
                    {result.columns.map((c) => {
                      const v = row[c]
                      const isNull = v === null || v === undefined
                      const text = isNull ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)
                      return <td key={c} className={cn('max-w-[220px] truncate border-b border-line/50 px-2 py-1 font-mono', isNull ? 'italic text-muted' : 'text-fg')} title={text}>{text}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 py-1.5 text-[11px] text-muted">{result.rowCount}행 · {result.executionTimeMs}ms</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
