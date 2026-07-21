import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ChevronDown, GripVertical, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/ui/dropdown-menu'
import { Input } from '@renderer/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { cn } from '@renderer/lib/utils'
import { useActiveTable, useDefinitionStore, useDesignTables } from './store'
import { RefTableCard } from './FkRef'
import { checkColumns, resolveColumns } from './derive'
import type { Constraint, ConstraintKind, FkAction, TableDef } from './types'

const CONSTRAINT_KINDS: ConstraintKind[] = ['pk', 'uk', 'fk', 'check', 'idx']
const KIND_LABEL: Record<ConstraintKind, string> = {
  pk: 'Primary Key',
  uk: 'Unique',
  fk: 'Foreign Key',
  check: 'Check',
  idx: 'Index'
}
const FK_ACTIONS: FkAction[] = ['RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION']

const reorder = <T,>(arr: T[], from: number, to: number): T[] => {
  const a = [...arr]
  const [m] = a.splice(from, 1)
  a.splice(to, 0, m)
  return a
}

/** 접힌 행의 요약 — 순서 서수·방향·FK 참조·정책을 구조에서 그대로 그린다. */
function ConstraintSummary({ table, con }: { table: TableDef; con: Constraint }) {
  if (con.kind === 'check') {
    return <span className="truncate font-mono text-[12px] text-muted">{con.expression || '—'}</span>
  }
  const cols = resolveColumns(table, con)
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {cols.length === 0 && <span className="text-[12px] text-muted/60">컬럼 없음 — 클릭해서 편집</span>}
      {cols.map((c, i) => (
        <span
          key={c.columnId}
          className="flex shrink-0 items-center gap-1 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px] text-fg"
        >
          {cols.length > 1 && <span className="font-semibold text-muted">{i + 1}</span>}
          {c.name}
          {c.direction === 'DESC' && <ArrowDown className="size-3 text-muted" />}
        </span>
      ))}
      {con.kind === 'fk' && (
        <>
          <span className="shrink-0 text-[12px] text-accent-2">→</span>
          <span className="shrink-0 font-mono text-[11px] text-accent">
            {con.refTable || '?'} ({(con.refColumns ?? []).join(', ') || '?'})
          </span>
          <span className="shrink-0 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[10px] text-muted">
            DEL {con.onDelete ?? 'RESTRICT'}
          </span>
          <span className="shrink-0 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[10px] text-muted">
            UPD {con.onUpdate ?? 'RESTRICT'}
          </span>
        </>
      )}
    </span>
  )
}

/** 에디터 내부의 정렬 가능한 컬럼 행 (grip 드래그 + 순서 서수 + 방향 + 제거). */
function EditorColumnRow({
  table,
  con,
  index
}: {
  table: TableDef
  con: Constraint
  index: number
}) {
  const updateConstraint = useDefinitionStore((s) => s.updateConstraint)
  const ref = con.columns[index]
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ref.columnId
  })

  const usedIds = con.columns.map((r) => r.columnId)
  const options = table.columns.filter((c) => c.id === ref.columnId || !usedIds.includes(c.id))
  // FK 참조 대상은 같은 설계 스코프에서만 해석.
  const refTableDef = useDesignTables().find((t) => t.name === con.refTable)

  const setColumns = (patch: Partial<Constraint>) => updateConstraint(con.id, patch)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex items-center gap-2 rounded-md px-1 py-1',
        isDragging && 'relative z-10 bg-panel-strong shadow-md'
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        aria-label="드래그로 순서 변경"
        className="cursor-grab text-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>
      <span className="w-4 text-right font-mono text-[11px] font-semibold tabular-nums text-muted">
        {index + 1}
      </span>

      <Select
        value={ref.columnId}
        onValueChange={(v) =>
          setColumns({
            columns: con.columns.map((r, i) => (i === index ? { ...r, columnId: v } : r))
          })
        }
      >
        <SelectTrigger size="sm" className="w-44 font-mono text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id} className="font-mono text-[12px]">
              {c.name || '(이름 없음)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {con.kind === 'idx' && (
        <Select
          value={ref.direction ?? 'ASC'}
          onValueChange={(v) =>
            setColumns({
              columns: con.columns.map((r, i) =>
                i === index ? { ...r, direction: v as 'ASC' | 'DESC' } : r
              )
            })
          }
        >
          <SelectTrigger size="sm" className="w-20 font-mono text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ASC" className="font-mono text-[12px]">ASC</SelectItem>
            <SelectItem value="DESC" className="font-mono text-[12px]">DESC</SelectItem>
          </SelectContent>
        </Select>
      )}

      {con.kind === 'fk' && (
        <>
          <span className="text-[12px] text-accent-2">→</span>
          <Select
            value={(con.refColumns ?? [])[index] || undefined}
            onValueChange={(v) =>
              setColumns({
                refColumns: (con.refColumns ?? con.columns.map(() => '')).map((rc, i) =>
                  i === index ? v : rc
                )
              })
            }
          >
            <SelectTrigger size="sm" className="w-40 font-mono text-[12px]">
              <SelectValue placeholder="참조 컬럼" />
            </SelectTrigger>
            <SelectContent>
              {(refTableDef?.columns ?? []).map((c) => (
                <SelectItem key={c.id} value={c.name} className="font-mono text-[12px]">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="컬럼 제거"
        onClick={() =>
          setColumns({
            columns: con.columns.filter((_, i) => i !== index),
            ...(con.kind === 'fk' && {
              refColumns: (con.refColumns ?? []).filter((_, i) => i !== index)
            })
          })
        }
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

/** 인라인 제약 에디터 — 이름 · 컬럼(순서/방향) · FK 참조/정책 · CHECK 식. */
function ConstraintEditor({ table, con }: { table: TableDef; con: Constraint }) {
  const updateConstraint = useDefinitionStore((s) => s.updateConstraint)
  // 참조 테이블 후보는 같은 설계의 테이블로 한정.
  const tables = useDesignTables()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const unused = table.columns.filter((c) => !con.columns.some((r) => r.columnId === c.id))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = con.columns.findIndex((r) => r.columnId === active.id)
    const to = con.columns.findIndex((r) => r.columnId === over.id)
    if (from < 0 || to < 0) return
    updateConstraint(con.id, {
      columns: reorder(con.columns, from, to),
      ...(con.kind === 'fk' &&
        con.refColumns && { refColumns: reorder(con.refColumns, from, to) })
    })
  }

  return (
    <div className="border-t border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          이름
          <Input
            value={con.name}
            onChange={(e) => updateConstraint(con.id, { name: e.target.value })}
            className="h-7 w-56 font-mono text-[12px] normal-case tracking-normal"
          />
        </label>

        {con.kind === 'fk' && (
          <>
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              참조 테이블
              <Select
                value={con.refTable || undefined}
                onValueChange={(v) =>
                  updateConstraint(con.id, { refTable: v, refColumns: con.columns.map(() => '') })
                }
              >
                <SelectTrigger size="sm" className="w-40 font-mono text-[12px]">
                  <SelectValue placeholder="테이블 선택" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.name} className="font-mono text-[12px]">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              ON DELETE
              <Select
                value={con.onDelete ?? 'RESTRICT'}
                onValueChange={(v) => updateConstraint(con.id, { onDelete: v as FkAction })}
              >
                <SelectTrigger size="sm" className="w-36 font-mono text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FK_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="font-mono text-[12px]">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              ON UPDATE
              <Select
                value={con.onUpdate ?? 'RESTRICT'}
                onValueChange={(v) => updateConstraint(con.id, { onUpdate: v as FkAction })}
              >
                <SelectTrigger size="sm" className="w-36 font-mono text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FK_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a} className="font-mono text-[12px]">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </>
        )}
      </div>

      {con.kind === 'check' ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            조건식
            <Input
              value={con.expression ?? ''}
              onChange={(e) => updateConstraint(con.id, { expression: e.target.value })}
              placeholder="예: total_amount >= 0 · start_date <= end_date (여러 컬럼 가능)"
              className="h-7 w-[28rem] font-mono text-[12px] normal-case tracking-normal"
            />
          </label>
          {(() => {
            const refs = checkColumns(table, con)
            return (
              <div className="flex items-center gap-1.5 pl-[3.25rem] text-[11px] text-muted">
                <span className="uppercase tracking-wide">참조 컬럼</span>
                {refs.length === 0 ? (
                  <span className="italic text-muted/60">식에서 인식된 컬럼 없음</span>
                ) : (
                  refs.map((c) => (
                    <span
                      key={c.columnId}
                      className="rounded bg-success-soft px-1.5 py-0.5 font-mono text-[10px] text-success"
                    >
                      {c.name}
                    </span>
                  ))
                )}
              </div>
            )
          })()}
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            컬럼 {con.columns.length > 1 && <span className="normal-case">(드래그로 순서 변경 — 순서가 중요)</span>}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={con.columns.map((r) => r.columnId)}
              strategy={verticalListSortingStrategy}
            >
              {con.columns.map((_, i) => (
                <EditorColumnRow key={con.columns[i].columnId} table={table} con={con} index={i} />
              ))}
            </SortableContext>
          </DndContext>
          {con.kind === 'fk' && <RefTableCard con={con} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="soft" size="sm" className="mt-1.5" disabled={unused.length === 0}>
                <Plus />
                컬럼 추가
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {unused.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  className="font-mono text-[12px]"
                  onSelect={() =>
                    updateConstraint(con.id, {
                      columns: [...con.columns, { columnId: c.id }],
                      ...(con.kind === 'fk' && { refColumns: [...(con.refColumns ?? []), ''] })
                    })
                  }
                >
                  {c.name || '(이름 없음)'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

/** Constraints 섹션 — 구조화 표시 + 행 클릭으로 인라인 에디터 토글. readOnly 면 열람 전용. */
export function ConstraintsSection({ readOnly = false }: { readOnly?: boolean }) {
  const table = useActiveTable()
  const addConstraint = useDefinitionStore((s) => s.addConstraint)
  const deleteConstraint = useDefinitionStore((s) => s.deleteConstraint)
  const openId = useDefinitionStore((s) => s.openConstraintId)
  const setOpen = useDefinitionStore((s) => s.setOpenConstraint)

  // 부모(TableForm)가 테이블 존재를 보장하지만 방어적으로 가드.
  if (!table) return null

  return (
    <>
      <div className="mb-2 mt-6 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Constraints
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-fg">
          {table.constraints.length}
        </span>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="soft" size="sm" className="ml-auto">
                <Plus />
                제약 추가
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {CONSTRAINT_KINDS.map((k) => (
                <DropdownMenuItem key={k} onSelect={() => addConstraint(k)}>
                  <Badge variant={k} className="text-[10px]">
                    {k.toUpperCase()}
                  </Badge>
                  {KIND_LABEL[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line">
        {table.constraints.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-muted">제약이 없습니다</div>
        )}
        {table.constraints.map((k) => {
          const open = openId === k.id
          return (
            <div key={k.id} className="border-b border-line last:border-b-0">
              <div
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? undefined : 0}
                onClick={readOnly ? undefined : () => setOpen(open ? null : k.id)}
                onKeyDown={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpen(open ? null : k.id)
                        }
                      }
                }
                className={cn(
                  'group grid items-center text-[12px] outline-none',
                  !readOnly && 'cursor-pointer hover:bg-panel/60 focus-visible:bg-panel/60',
                  open && !readOnly && 'bg-panel/60'
                )}
                style={{ gridTemplateColumns: '76px minmax(150px,210px) 1fr 30px 34px', minHeight: 36 }}
              >
                <div className="px-2.5">
                  <Badge variant={k.kind} className="text-[10px]">
                    {k.kind.toUpperCase()}
                  </Badge>
                </div>
                <div className="truncate px-1.5 font-mono text-fg" title={k.name}>
                  {k.name}
                </div>
                <div className="min-w-0 px-1.5">
                  <ConstraintSummary table={table} con={k} />
                </div>
                {readOnly ? (
                  <span />
                ) : (
                  <ChevronDown
                    className={cn('size-3.5 text-muted transition-transform', open && 'rotate-180')}
                  />
                )}
                {readOnly ? (
                  <span />
                ) : (
                  <div
                    className="flex justify-center text-transparent group-hover:text-muted"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-6" aria-label="제약 메뉴">
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem variant="destructive" onSelect={() => deleteConstraint(k.id)}>
                          <Trash2 />
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
              {open && !readOnly && <ConstraintEditor table={table} con={k} />}
            </div>
          )
        })}
      </div>
    </>
  )
}
