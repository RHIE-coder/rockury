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
import { ArrowDown, ArrowUp, Eye, GripVertical, MoreHorizontal, Pencil, Plus, Table2, Trash2 } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useActiveDesign } from '../../designs/store'
import { dialectInfo } from '../../dialects'
import { defaultSuggestions, isKnownType, typeSuggestions } from '../../typeCatalog'
import { useActiveTable, useDefinitionStore, useDesignTables, useDesignReadOnly } from './store'
import { checkColumnIds, keyBadgesOf, type KeyBadge } from './derive'
import { EditableText } from './EditableText'
import { ConstraintsSection } from './ConstraintsSection'
import { ViewBodySection } from './ViewBodySection'
import { FkBadge } from './FkRef'
import type { Column } from './types'

// 그리드 열: drag · # · Name · Type · Keys · Null · Default · Comment · actions
// 최소폭 합 ~662px — 최소 창(960)에서도 표가 통째로 들어오고, 유연 열(name/type/default/comment)은
// 말줄임 처리된다. 그보다 좁아지면 카드 안에서 가로 스크롤(GRID_MIN_W).
const GRID =
  '24px 28px minmax(100px,1.1fr) minmax(120px,1.3fr) 108px 40px minmax(90px,0.9fr) minmax(120px,1.4fr) 32px'
// 뷰 그리드 — Keys 열이 없다. 뷰에는 제약을 걸 수 없으니 영원히 빈 열이 되어 자리만 먹는다.
const VIEW_GRID =
  '24px 28px minmax(100px,1.1fr) minmax(120px,1.3fr) 40px minmax(90px,0.9fr) minmax(120px,1.4fr) 32px'
const GRID_MIN_W = 660

/** 컬럼 행 ⋯ 메뉴 — 이동 · 키 토글(제약 기반) · 삭제. FK 는 제약 에디터에서. */
function ColumnMenu({
  colId,
  index,
  count,
  badges,
  isView
}: {
  colId: string
  index: number
  count: number
  badges: KeyBadge[]
  /** 뷰의 결과 컬럼이면 키 토글을 감춘다 — 뷰에는 제약을 걸 수 없다. */
  isView: boolean
}) {
  const moveColumn = useDefinitionStore((s) => s.moveColumn)
  const deleteColumn = useDefinitionStore((s) => s.deleteColumn)
  const togglePk = useDefinitionStore((s) => s.togglePk)
  const toggleUnique = useDefinitionStore((s) => s.toggleUnique)
  const toggleIndex = useDefinitionStore((s) => s.toggleIndex)
  const has = (k: KeyBadge['kind']) => badges.some((b) => b.kind === k)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label="컬럼 메뉴">
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem disabled={index === 0} onSelect={() => moveColumn(colId, -1)}>
          <ArrowUp />
          위로 이동
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => moveColumn(colId, 1)}>
          <ArrowDown />
          아래로 이동
        </DropdownMenuItem>
        {!isView && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>키 (제약으로 반영)</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={has('pk')}
              onCheckedChange={() => togglePk(colId)}
              onSelect={(e) => e.preventDefault()}
            >
              Primary Key
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={has('uk')}
              onCheckedChange={() => toggleUnique(colId)}
              onSelect={(e) => e.preventDefault()}
            >
              Unique
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={has('idx')}
              onCheckedChange={() => toggleIndex(colId)}
              onSelect={(e) => e.preventDefault()}
            >
              Index
            </DropdownMenuCheckboxItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => deleteColumn(colId)}>
          <Trash2 />
          삭제
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 드래그 정렬 가능한 컬럼 행. grip 핸들만 드래그 활성(셀 편집과 충돌 방지). */
function SortableColumnRow({
  c,
  index,
  count,
  badges,
  inCheck,
  readOnly,
  isView
}: {
  c: Column
  index: number
  count: number
  badges: KeyBadge[]
  inCheck: boolean
  readOnly: boolean
  isView: boolean
}) {
  const updateColumn = useDefinitionStore((s) => s.updateColumn)
  const toggleNullable = useDefinitionStore((s) => s.toggleNullable)
  const design = useActiveDesign()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: c.id,
    disabled: readOnly
  })
  const dialect = design?.dialect

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group grid items-center border-b border-line last:border-b-0 hover:bg-panel/60',
        isDragging && 'relative z-10 rounded-md bg-panel opacity-90 shadow-lg'
      )}
      style={{
        gridTemplateColumns: isView ? VIEW_GRID : GRID,
        minHeight: 34,
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      {readOnly ? (
        <span />
      ) : (
        <button
          type="button"
          aria-label="드래그로 순서 변경"
          className="flex cursor-grab justify-center text-transparent group-hover:text-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={13} />
        </button>
      )}
      <div className="px-1 text-right text-[11px] tabular-nums text-muted">{index + 1}</div>
      <div className="flex items-center gap-1.5 px-1">
        {c.drift && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="size-1.5 shrink-0 cursor-help rounded-full bg-accent-2 outline-none ring-accent-2/40 focus-visible:ring-2"
              />
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-semibold">운영 드리프트 흡수 · {c.drift.version}</span>
              <br />
              Rockury를 거치지 않고 실 DB(운영)에 직접 추가된 변경이 설계로 편입된 컬럼
            </TooltipContent>
          </Tooltip>
        )}
        <EditableText
          editKey={`col:${c.id}:name`}
          value={c.name}
          placeholder="컬럼명"
          readOnly={readOnly}
          onCommit={(v) => updateColumn(c.id, { name: v })}
        />
      </div>
      <div className="px-1">
        <EditableText
          editKey={`col:${c.id}:type`}
          value={c.type}
          placeholder="타입"
          mono
          readOnly={readOnly}
          onCommit={(v) => updateColumn(c.id, { type: v })}
          suggest={dialect ? (q) => typeSuggestions(dialect, q) : undefined}
          suggestFooter="목록에 없는 타입도 입력 가능 — extension·domain 타입은 ⚠ 표시만, 차단하지 않음"
          warnTitle={
            dialect && !isKnownType(dialect, c.type)
              ? `${dialectInfo(dialect).label} 카탈로그에 없는 타입 — extension·domain 타입이면 무시해도 돼요`
              : undefined
          }
        />
      </div>
      {!isView && (
        <div className="flex gap-1 px-1">
          {badges.map((b) =>
            b.kind === 'fk' ? (
              <FkBadge key="fk" colId={c.id} pos={b.pos} />
            ) : (
              <Badge key={b.kind} variant={b.kind} className="px-1.5 py-0.5 text-[10px]">
                {b.kind.toUpperCase()}
                {b.pos != null && <span className="opacity-70">·{b.pos}</span>}
              </Badge>
            )
          )}
          {inCheck && (
            <Badge variant="check" className="px-1.5 py-0.5 text-[10px]" title="CHECK 제약에 참여">
              CHK
            </Badge>
          )}
        </div>
      )}
      <div className="flex justify-center">
        {/*
          PK 컬럼은 잠근다 — PK 는 SQL 표준에서 곧 NOT NULL 이라 켤 수 있게 두면 실 DB 에 없는
          모습이 설계에 생긴다(2026-08-12 사용자: "PK인데 null이 가능해?"). 값 자체는 스토어가
          이미 NOT NULL 로 잡으므로(`enforcePkNotNull`) 여기서는 손잡이만 닫는다. 왜 닫혔는지는
          바로 옆 칸의 PK 배지가 말한다 — 툴팁을 또 달지 않는다.
        */}
        <Checkbox
          checked={c.nullable}
          disabled={readOnly || badges.some((b) => b.kind === 'pk')}
          onCheckedChange={() => toggleNullable(c.id)}
          aria-label="nullable"
        />
      </div>
      <div className="px-1">
        <EditableText
          editKey={`col:${c.id}:default`}
          value={c.defaultValue ?? ''}
          placeholder="—"
          mono
          readOnly={readOnly}
          onCommit={(v) => updateColumn(c.id, { defaultValue: v.trim() === '' ? null : v })}
          suggest={dialect ? (q) => defaultSuggestions(dialect, q) : undefined}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-1">
        {c.drift && (
          <span className="shrink-0 rounded bg-accent-2-soft px-1 py-0.5 font-mono text-[10px] text-accent-2">
            {c.drift.version}
          </span>
        )}
        <EditableText
          editKey={`col:${c.id}:comment`}
          value={c.comment}
          placeholder="설명"
          readOnly={readOnly}
          onCommit={(v) => updateColumn(c.id, { comment: v })}
        />
      </div>
      <div className="flex justify-center text-transparent group-hover:text-muted">
        {!readOnly && (
          <ColumnMenu colId={c.id} index={index} count={count} badges={badges} isView={isView} />
        )}
      </div>
    </div>
  )
}

export function TableForm() {
  const design = useActiveDesign()
  const table = useActiveTable()
  const siblings = useDesignTables()
  const addColumn = useDefinitionStore((s) => s.addColumn)
  const reorderColumns = useDefinitionStore((s) => s.reorderColumns)
  const updateTable = useDefinitionStore((s) => s.updateTable)
  const deleteTable = useDefinitionStore((s) => s.deleteTable)
  const toggleView = useDefinitionStore((s) => s.toggleView)
  const setEditing = useDefinitionStore((s) => s.setEditing)
  const readOnly = useDesignReadOnly()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  /*
   * 잘린 칸을 보는 손잡이는 **칸 자신**이 든다(`ui/clipped`) — 여기 있던 "전문 보기" 체크박스는
   * 걷어냈다. 표 하나에 켜고 끄는 스위치를 두면 긴 칸 하나 보려고 표 전체 줄이 바뀌었고,
   * 사용자는 그 체크박스 자체를 걸고 넘어졌다(2026-08-12: "체크박스말고 좀 더 우아한 방법 없어?").
   */

  // 부모(DefinitionWorkspace)가 설계 선택·테이블 존재를 보장하지만 방어적으로 가드.
  if (!design || !table) return null

  const isView = !!table.isView
  const badgeMap = keyBadgesOf(table)
  const checkCols = checkColumnIds(table)

  const onDragEnd = (e: DragEndEvent) => {
    if (readOnly) return
    const { active, over } = e
    if (over && active.id !== over.id) reorderColumns(String(active.id), String(over.id))
  }

  /**
   * 테이블 → 뷰 전환은 제약을 버린다(뷰엔 걸 수 없으므로) — 되돌릴 수 없으니 먼저 묻는다.
   * Radix 메뉴아이템에서 곧장 블로킹 확인창을 띄우면 body `pointer-events:none` 이 남는다 →
   * 프로젝트 관례대로 다음 틱으로 미룬다(e2e/README 함정).
   */
  const askToggleView = (): void => {
    const losing = !isView && table.constraints.length > 0
    setTimeout(() => {
      if (
        losing &&
        !window.confirm(
          `뷰로 바꾸면 이 테이블의 제약 ${table.constraints.length}개(PK·FK·인덱스 등)가 지워집니다. 뷰에는 제약을 걸 수 없어요. 계속할까요?`
        )
      )
        return
      toggleView()
    }, 0)
  }

  return (
    <div className="mx-auto max-w-[1160px] px-5 py-4">
      {/* 헤더 (편집 가능) */}
      <div className="mb-3.5 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[16px] font-bold tracking-tight text-fg">
            <span className="whitespace-nowrap font-medium text-muted">{design.name}</span>
            <span
              title="설계 방언 — 타입·디폴트는 이 벤더의 네이티브 구문 그대로"
              className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-muted"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: dialectInfo(design.dialect).dot }}
              />
              {dialectInfo(design.dialect).label}
            </span>
            <span className="font-medium text-muted">/</span>
            {isView && (
              <span
                data-definition-view-badge
                title="뷰 — 실 DB 에는 CREATE VIEW 로 만들어져요"
                className="flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-info"
              >
                <Eye className="size-3" />뷰
              </span>
            )}
            {/* 스키마 — 이름 앞 칸. 여러 스키마를 쓰기 시작하면 그 자리에서 바로 옮길 수 있다
                (§db-design.definition.schema). 비면 `이름 없음` 으로 보인다: 예전엔 여기에
                `public` 을 넣어 보였는데, MySQL 설계에서 그건 있지도 않은 이름이었다(2026-08-11).
                이름을 정하는 자리는 설계 손잡이의 "스키마 관리"다. */}
            <EditableText
              editKey="table:schema"
              value={table.schema ?? ''}
              placeholder="이름 없음"
              readOnly={readOnly}
              onCommit={(v) => updateTable({ schema: v.trim() || undefined })}
              className="w-auto text-[15px] font-semibold text-muted"
              inputClassName="h-8 w-40 text-[15px] font-semibold"
            />
            {/* 스키마를 모르는 표는 `.` 도 안 찍는다 — 앞이 빈 점만 남으면 고장으로 읽힌다. */}
            {table.schema && <span className="text-[15px] font-semibold text-muted">.</span>}
            <EditableText
              editKey="table:name"
              value={table.name}
              readOnly={readOnly}
              onCommit={(v) => updateTable({ name: v })}
              className="w-auto text-[16px] font-bold"
              inputClassName="h-8 w-56 text-[15px] font-semibold"
            />
          </div>
          <EditableText
            editKey="table:comment"
            value={table.comment}
            placeholder="설명 추가"
            readOnly={readOnly}
            onCommit={(v) => updateTable({ comment: v })}
            className="mt-0.5 w-auto text-[12px] text-muted"
            inputClassName="h-7 w-72 text-[12px]"
          />
        </div>
        <div className="ml-auto flex items-center gap-2.5 whitespace-nowrap text-[11.5px] tabular-nums text-muted">
          <span>{isView ? `결과 컬럼 ${table.columns.length}` : `${table.columns.length} columns`}</span>
          {!isView && (
            <>
              <span>·</span>
              <span>{table.constraints.length} constraints</span>
            </>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-1.5">
            <Button size="sm" onClick={addColumn}>
              <Plus />
              {isView ? '결과 컬럼 추가' : '컬럼 추가'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="더 보기">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setEditing('table:name')}>
                  <Pencil />
                  이름 편집
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing('table:comment')}>
                  <Pencil />
                  설명 편집
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-definition-toggle-view onSelect={() => askToggleView()}>
                  {isView ? <Table2 /> : <Eye />}
                  {isView ? '테이블로 바꾸기' : '뷰로 바꾸기'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => deleteTable(table.id)}>
                  <Trash2 />
                  {isView ? '뷰 삭제' : '테이블 삭제'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* 뷰면 본문 SELECT 가 먼저 — 아래 컬럼 표는 그 본문이 내놓는 결과 컬럼이다. */}
      {isView && (
        <ViewBodySection table={table} dialect={design.dialect} siblings={siblings} readOnly={readOnly} />
      )}

      {isView && (
        <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">결과 컬럼</h3>
      )}

      {/* 컬럼 그리드 (드래그 정렬) — 좁은 폭에선 카드 안에서만 가로 스크롤(본문은 안 밀림) */}
      <div className="overflow-x-auto rounded-[10px] border border-line">
       <div style={{ minWidth: GRID_MIN_W }}>
        <div
          className="grid items-center bg-panel text-[11px] font-semibold uppercase tracking-wide text-muted"
          style={{ gridTemplateColumns: isView ? VIEW_GRID : GRID, minHeight: 30 }}
        >
          <div />
          <div className="px-1 text-right">#</div>
          <div className="px-1">Name</div>
          <div className="px-1">Type</div>
          {!isView && <div className="px-1">Keys</div>}
          <div className="text-center">Null</div>
          <div className="px-1">Default</div>
          <div className="px-1">Comment</div>
          <div />
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={table.columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {table.columns.map((c, i) => (
              <SortableColumnRow
                key={c.id}
                c={c}
                index={i}
                count={table.columns.length}
                badges={badgeMap.get(c.id) ?? []}
                inCheck={checkCols.has(c.id)}
                readOnly={readOnly}
                isView={isView}
              />
            ))}
          </SortableContext>
        </DndContext>

        {!readOnly && (
          <div className="border-t border-dashed border-line px-3 py-2 pl-[56px]">
            <Button variant="soft" size="sm" onClick={addColumn}>
              <Plus />
              {isView ? '결과 컬럼 추가' : '컬럼 추가'}
            </Button>
          </div>
        )}
       </div>
      </div>

      {/* 뷰에는 제약을 걸 수 없다 — 구역 자체를 감춘다(빈 구역이 "걸 수 있다"는 오해를 준다). */}
      {!isView && <ConstraintsSection readOnly={readOnly} />}
    </div>
  )
}
