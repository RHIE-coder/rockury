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
import { ChevronRight, FolderPlus, Layers, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useActiveConnection } from '../connections/store'
import { flattenTree, getProjection, removeChildrenOf, type FlatNode } from './collection/tree'
import { toLibNodes, useCollectionStore, type ItemStatus } from './collection/store'

const INDENT = 16

/** 트리 한 행 — dnd-kit sortable. 폴더/쿼리, 들여쓰기, 더블클릭 이름수정, 삭제. */
function TreeRow({
  node,
  onRename,
  onDelete
}: {
  node: FlatNode
  onRename: (id: string, kind: 'folder' | 'query', name: string) => void
  onDelete: (id: string, kind: 'folder' | 'query') => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  const [editing, setEditing] = useState(false)
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingLeft: node.depth * INDENT + 8 }}
      className={cn('flex items-center gap-1.5 py-1 pr-2 text-[12px]', isDragging && 'opacity-50')}
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
        <span
          onDoubleClick={() => setEditing(true)}
          className={cn('min-w-0 flex-1 truncate font-mono', node.kind === 'folder' ? 'font-semibold text-fg' : 'text-muted')}
          title={node.kind === 'query' ? node.sql : node.name}
        >
          {node.name}
        </span>
      )}
      <button type="button" onClick={() => onDelete(node.id, node.kind)} className="ml-auto text-muted opacity-0 hover:text-destructive group-hover:opacity-100">
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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-50')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

/**
 * Console › Collection(운영부 · depth 3) — 저장쿼리 라이브러리(폴더 트리, DnD) +
 * 컬렉션(순서 있는 쿼리 묶음). Run-All 은 트랜잭션 게이트로 원자 실행 후 커밋/롤백.
 */
export function CollectionView() {
  const conn = useActiveConnection()
  const st = useCollectionStore()
  const [offsetLeft, setOffsetLeft] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [newItem, setNewItem] = useState({ name: '', sql: '' })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (conn) void st.load(conn.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.id])

  if (!conn) {
    return <PlaceholderView icon={Layers} depth="depth 3 · Console › Collection" title="연결을 선택하세요" subtitle="Connection 셀렉터에서 대상을 고르면 저장 쿼리·컬렉션을 관리할 수 있습니다." />
  }

  const flat = flattenTree(toLibNodes(st.folders, st.queries))
  // 드래그 중 자기 자손은 드롭 대상에서 제외.
  const visible = activeId ? removeChildrenOf(flat, [activeId]) : flat
  const activeCollection = st.collections.find((c) => c.id === st.activeCollectionId) ?? null

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragMove = (e: DragMoveEvent) => setOffsetLeft(e.delta.x)
  const onTreeDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    setActiveId(null)
    setOffsetLeft(0)
    if (!over) return
    const proj = getProjection(visible, active, over, Math.round(offsetLeft / INDENT))
    // 평탄 목록에서 active 를 over 위치로 옮기고 parentId 갱신 → 영속.
    const ids = visible.map((n) => n.id)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const reordered = [...visible]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    void st.applyReorder(
      reordered.map((n) => ({ id: n.id, kind: n.kind, parentId: n.id === active ? proj.parentId : n.parentId }))
    )
  }

  const onItemsDragEnd = (e: DragEndEvent) => {
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
        <div className="group max-h-[40%] min-h-0 overflow-auto border-b border-line pb-1">
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onTreeDragEnd}>
            <SortableContext items={visible.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {visible.map((n) => (
                <TreeRow key={n.id} node={n} onRename={(id, kind, name) => void st.rename(kind, id, name)} onDelete={(id, kind) => void st.remove(kind, id)} />
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
            <button
              key={c.id}
              type="button"
              onClick={() => void st.selectCollection(c.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] outline-none hover:bg-panel',
                c.id === st.activeCollectionId ? 'bg-accent-soft/50 text-accent' : 'text-fg'
              )}
            >
              <Layers className="size-3.5 shrink-0 opacity-60" />
              <span className="truncate">{c.name}</span>
            </button>
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
                {!st.tx ? (
                  <Button size="sm" disabled={st.running || st.items.length === 0} onClick={() => void st.runAll()}>
                    {st.running ? <Loader2 className="animate-spin" /> : <Play />} Run All ({st.items.length})
                  </Button>
                ) : null}
              </div>
            </div>

            {st.tx && (
              <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-soft/50 px-4 py-2.5 text-[12.5px]">
                <span className="min-w-0 flex-1">전체 실행됨 · 영향 <b className="font-mono">{st.tx.affected}</b>행 · 아직 커밋되지 않았습니다</span>
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
                      <div className="mb-1.5 flex cursor-grab items-start gap-2 rounded-md border border-line bg-canvas p-2">
                        <span className={cn('mt-1 size-2 shrink-0 rounded-full', STATUS_DOT[st.itemStatus[it.id] ?? 'pending'])} />
                        <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted">{idx + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium text-fg">{it.name || '(이름 없음)'}</div>
                          <div className="truncate font-mono text-[11px] text-muted" title={it.sql}>{it.sql}</div>
                        </div>
                        <button type="button" onClick={() => void st.removeItem(it.id)} className="text-muted hover:text-destructive" onPointerDown={(e) => e.stopPropagation()}>
                          <Trash2 className="size-3.5" />
                        </button>
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
              <Input value={newItem.name} onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))} placeholder="이름" className="h-8 w-28 text-[12px]" />
              <Input value={newItem.sql} onChange={(e) => setNewItem((v) => ({ ...v, sql: e.target.value }))} placeholder="SELECT …" className="h-8 flex-1 font-mono text-[12px]" />
              <Button type="submit" size="sm" disabled={!newItem.sql.trim()}>추가</Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
