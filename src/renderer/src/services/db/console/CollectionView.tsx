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
import { Ban, ChevronRight, ExternalLink, Eye, FolderPlus, Layers, Loader2, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/ui/dialog'
import { useNav } from '@renderer/nav/useNav'
import { useActiveConnection } from '../connections/store'
import { classifyStatement } from './query/classify'
import { useQueryStore, type QueryResult } from './query/store'
import { flattenTree, getProjection, removeChildrenOf, type FlatNode } from './collection/tree'
import { toLibNodes, useCollectionStore, type ItemStatus } from './collection/store'

const INDENT = 16

/** 트리 한 행 — 폴더/쿼리. 쿼리는 에디터로 열기/실행 연동(죽은 동선 해소). */
function TreeRow({
  node,
  onRename,
  onDelete,
  onOpen,
  onRun
}: {
  node: FlatNode
  onRename: (id: string, kind: 'folder' | 'query', name: string) => void
  onDelete: (id: string, kind: 'folder' | 'query') => void
  onOpen: (id: string, sql: string) => void
  onRun: (name: string, sql: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const [editing, setEditing] = useState(false)
  const isQuery = node.kind === 'query'
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      className={cn('group/row flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-50')}
    >
      <span {...attributes} {...listeners} className="cursor-grab text-muted">
        {node.kind === 'folder' ? <ChevronRight className="size-3.5" /> : <span className="inline-block w-3.5" />}
      </span>
      {editing ? (
        <Input
          autoFocus
          defaultValue={node.name}
          onBlur={(e) => {
            setEditing(false)
            if (e.target.value.trim() && e.target.value !== node.name) onRename(node.id, node.kind, e.target.value.trim())
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-6 w-40 text-[12px]"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          onClick={() => isQuery && node.sql != null && onOpen(node.id, node.sql)}
          className={cn('min-w-0 flex-1 truncate text-left font-mono', node.kind === 'folder' ? 'font-semibold text-fg' : 'text-muted hover:text-accent')}
          title={isQuery ? '클릭: 에디터로 열기 · 더블클릭: 이름 변경' : node.name}
        >
          {node.name}
        </button>
      )}
      {isQuery && !editing && (
        <>
          <button type="button" title="에디터로 열기" onClick={() => node.sql != null && onOpen(node.id, node.sql)} className="text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"><ExternalLink className="size-3.5" /></button>
          <button type="button" title="실행" onClick={() => node.sql != null && onRun(node.name, node.sql)} className="text-muted opacity-0 hover:text-accent group-hover/row:opacity-100"><Play className="size-3.5" /></button>
        </>
      )}
      <button type="button" title="삭제" onClick={() => onDelete(node.id, node.kind)} className="text-muted opacity-0 hover:text-destructive group-hover/row:opacity-100">
        <Trash2 className="size-3.5" />
      </button>
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

/**
 * Console › Collection(운영부 · depth 3) — 저장쿼리 라이브러리(폴더 트리, DnD) +
 * 컬렉션(순서 있는 쿼리 묶음). 트리 쿼리를 에디터로 열거나 실행, 컬렉션/폴더/쿼리 rename,
 * 아이템 SQL 편집, Run-All(중단/재시도/SELECT 결과 모달). Run-All 은 트랜잭션 게이트로 원자 실행.
 */
export function CollectionView() {
  const conn = useActiveConnection()
  const st = useCollectionStore()
  const [offsetLeft, setOffsetLeft] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({ name: '', sql: '' })
  const [editItem, setEditItem] = useState<{ id: string; name: string; sql: string } | null>(null)
  const [renameCol, setRenameCol] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [resultView, setResultView] = useState<string | null>(null)
  const [runPreview, setRunPreview] = useState<{ name: string; result?: QueryResult; error?: string } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (conn) void st.load(conn.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  if (!conn) {
    return <PlaceholderView icon={Layers} depth="depth 3 · Console › Collection" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 저장 쿼리·컬렉션을 관리할 수 있습니다." />
  }

  const flat = flattenTree(toLibNodes(st.folders, st.queries))
  const visible = activeId ? removeChildrenOf(flat, [activeId]) : flat
  const activeCollection = st.collections.find((c) => c.id === st.activeCollectionId) ?? null

  // 트리 쿼리 → 에디터로 열기(Query 탭 전환 + 자동저장 연결, 현재 연결로 스코프).
  const openInEditor = (id: string, sql: string): void => {
    useQueryStore.getState().loadSaved(id, sql, conn.id)
    useNav.getState().selectView('query')
  }
  // 트리 쿼리 실행 — read 는 결과 모달, 그 외(DML/DDL)는 안전하게 에디터(트랜잭션 게이트)로.
  const runFromTree = async (id: string, name: string, sql: string): Promise<void> => {
    if (classifyStatement(sql).kind !== 'read') {
      openInEditor(id, sql)
      return
    }
    setRunPreview({ name })
    try {
      const r = await window.rockury.query.run(conn.id, sql)
      setRunPreview({ name, result: r })
    } catch (e) {
      setRunPreview({ name, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const onDragStart = (e: DragStartEvent): void => setActiveId(String(e.active.id))
  const onDragMove = (e: DragMoveEvent): void => setOffsetLeft(e.delta.x)
  const onTreeDragEnd = (e: DragEndEvent): void => {
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setActiveId(null)
    setOffsetLeft(0)
    if (!over) return
    const proj = getProjection(visible, active, over, Math.round(offsetLeft / INDENT))
    const ids = visible.map((n) => n.id)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...visible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    void st.applyReorder(reordered.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === active ? proj.parentId : n.parentId })))
  }

  const onItemsDragEnd = (e: DragEndEvent): void => {
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (!over || active === over) return
    const ids = st.items.map((i) => i.id)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void st.reorderItems(ids)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 좌: 저장쿼리 트리 + 컬렉션 목록 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>쿼리 라이브러리</span>
          <button type="button" title="새 폴더" onClick={() => void st.addFolder('새 폴더')} className="text-muted hover:text-fg">
            <FolderPlus className="size-3.5" />
          </button>
        </div>
        <div className="max-h-[40%] min-h-0 overflow-auto border-b border-line pb-1">
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onTreeDragEnd}>
            <SortableContext items={visible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {visible.map((n) => (
                <TreeRow
                  key={n.id}
                  node={n}
                  onRename={(id, kind, name) => void st.rename(kind, id, name)}
                  onDelete={(id, kind) => void st.remove(kind, id)}
                  onOpen={openInEditor}
                  onRun={(name, sql) => void runFromTree(n.id, name, sql)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {flat.length === 0 && <div className="px-4 py-2 text-[11.5px] text-muted">저장된 쿼리가 없어요. Query 탭에서 저장하세요.</div>}
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>컬렉션</span>
          <button type="button" title="새 컬렉션" onClick={() => void st.addCollection('새 컬렉션')} className="text-muted hover:text-fg">
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {st.collections.map((c) => (
            <div key={c.id} className={cn('group/col flex items-center gap-2 px-3 py-1.5 text-[12px]', c.id === st.activeCollectionId ? 'bg-accent-soft/50 text-accent' : 'text-fg hover:bg-panel')}>
              <Layers className="size-3.5 shrink-0 opacity-60" />
              {renameCol === c.id ? (
                <Input
                  autoFocus
                  defaultValue={c.name}
                  onBlur={(e) => { setRenameCol(null); if (e.target.value.trim() && e.target.value !== c.name) void st.renameCollection(c.id, e.target.value.trim()) }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="h-6 w-40 text-[12px]"
                />
              ) : (
                <button type="button" onClick={() => void st.selectCollection(c.id)} onDoubleClick={() => setRenameCol(c.id)} className="min-w-0 flex-1 truncate text-left outline-none" title="클릭: 열기 · 더블클릭: 이름 변경">
                  {c.name}
                </button>
              )}
              <button type="button" title="이름 변경" onClick={() => setRenameCol(c.id)} className="text-muted opacity-0 hover:text-accent group-hover/col:opacity-100"><Pencil className="size-3" /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* 우: 활성 컬렉션 아이템 + Run-All */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!activeCollection ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">컬렉션을 선택하거나 새로 만드세요</div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-semibold text-fg">{activeCollection.name}</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void st.removeCollection(activeCollection.id)}>
                  <Trash2 /> 삭제
                </Button>
                {st.running ? (
                  <Button size="sm" variant="outline" onClick={() => void st.abort()}>
                    <Ban /> 중단
                  </Button>
                ) : st.error && !st.tx ? (
                  <Button size="sm" variant="outline" onClick={() => void st.retry()}>
                    <RotateCcw /> 재시도
                  </Button>
                ) : !st.tx ? (
                  <Button size="sm" disabled={st.items.length === 0} onClick={() => void st.runAll()}>
                    <Play /> Run All ({st.items.length})
                  </Button>
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
              <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
                {st.error} <button type="button" className="ml-2 opacity-70" onClick={st.dismissError}>✕</button>
              </div>
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
                          <div className="truncate font-mono text-[11px] text-muted" title={it.sql}>{it.sql}</div>
                        </div>
                        <button type="button" onClick={() => void st.runOne(it.id)} onPointerDown={(e) => e.stopPropagation()} disabled={st.running} className="text-muted hover:text-accent disabled:opacity-40" title="이 아이템만 실행(열린 트랜잭션에 이어붙임 · 개별 커밋 안 함)"><Play className="size-3.5" /></button>
                        {st.results[it.id] && (
                          <button type="button" onClick={() => setResultView(it.id)} onPointerDown={(e) => e.stopPropagation()} className="text-muted hover:text-accent" title="결과 보기"><Eye className="size-3.5" /></button>
                        )}
                        {/* 참조 아이템은 원본(라이브러리)에서 편집 — 여기선 즉석 아이템만 편집. */}
                        {!it.savedQueryId && (
                          <button type="button" onClick={() => setEditItem({ id: it.id, name: it.name, sql: it.sql })} onPointerDown={(e) => e.stopPropagation()} className="text-muted opacity-0 hover:text-accent group-hover/item:opacity-100" title="편집"><Pencil className="size-3.5" /></button>
                        )}
                        <button type="button" onClick={() => void st.removeItem(it.id)} onPointerDown={(e) => e.stopPropagation()} className="text-muted hover:text-destructive" title="삭제"><Trash2 className="size-3.5" /></button>
                      </div>
                    </SortableItem>
                  ))}
                </SortableContext>
              </DndContext>
              {st.items.length === 0 && <div className="py-4 text-center text-[12px] text-muted">아이템이 없어요. 아래에서 추가하세요.</div>}
            </div>

            {/* 인라인 아이템 추가 */}
            <form
              className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!newItem.sql.trim()) return
                void st.addItem(newItem.name.trim() || '쿼리', newItem.sql.trim())
                setNewItem({ name: '', sql: '' })
              }}
            >
              <Button type="button" size="sm" variant="outline" onClick={() => setShowPicker(true)} title="라이브러리 저장쿼리를 참조로 추가">
                <Plus /> 쿼리 참조
              </Button>
              <Input value={newItem.name} onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))} placeholder="즉석 이름" className="h-8 w-28 text-[12px]" />
              <Input value={newItem.sql} onChange={(e) => setNewItem((v) => ({ ...v, sql: e.target.value }))} placeholder="즉석 SELECT …" className="h-8 flex-1 font-mono text-[12px]" />
              <Button type="submit" size="sm" disabled={!newItem.sql.trim()}>추가</Button>
            </form>
          </>
        )}
      </div>

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

      {/* 저장쿼리 참조 피커 */}
      <Dialog open={showPicker} onOpenChange={(o) => !o && setShowPicker(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>쿼리 참조 추가</DialogTitle></DialogHeader>
          <div className="mt-2 max-h-[50vh] overflow-auto">
            {st.queries.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted">라이브러리에 저장된 쿼리가 없어요. Query 탭에서 저장하세요.</div>
            ) : (
              st.queries.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => { void st.addReference(q.id); setShowPicker(false) }}
                  className="flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2 text-left outline-none hover:bg-panel"
                >
                  <span className="truncate text-[12px] font-medium text-fg">{q.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted">{q.sql}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Run-All SELECT 결과 모달 */}
      <ResultModal
        open={!!resultView}
        title={st.items.find((i) => i.id === resultView)?.name ?? ''}
        result={resultView ? st.results[resultView] : undefined}
        onClose={() => setResultView(null)}
      />

      {/* 트리에서 실행한 read 쿼리 결과 모달 */}
      <ResultModal
        open={!!runPreview}
        title={runPreview?.name ?? ''}
        result={runPreview?.result}
        error={runPreview?.error}
        onClose={() => setRunPreview(null)}
      />
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
              <thead className="sticky top-0 bg-panel">
                <tr>{result.columns.map((c) => <th key={c} className="border-b border-line px-2 py-1 text-left font-mono">{c}</th>)}</tr>
              </thead>
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
