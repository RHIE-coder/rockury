import { Table2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { CopyMenu, type CopyItem } from '@renderer/ui/copy-menu'
import { constraintCopyItems, tableCopyItems } from './copyText'
import {
  countByKind,
  filterByKind,
  filterIncoming,
  flattenConstraints,
  groupConstraintsByTable,
  KIND_FILTERS,
  type KindFilter
} from './remote/constraintsView'
import { sameTable, type TableRef } from './schemaRef'
import type { Constraint, TableDef } from './workspaces/definition/types'

/**
 * 제약 목록 패널 — Definition·Diagram·Data 가 공유하는 **하나뿐인** 제약 목록 표현.
 * 종류 필터(ALL/PK/FK/UK/IDX/CHECK) + 테이블별 그룹. 항목을 누르면 그 테이블로 이동한다.
 * 집계·정렬은 순수 로직(`remote/constraintsView`)이 하고 여기서는 그리기만 한다.
 */
export function ConstraintListPanel({
  tables,
  activeTable,
  onPickTable,
  filter,
  onFilterChange,
  incomingOnly,
  onIncomingOnlyChange
}: {
  tables: TableDef[]
  /** 현재 보고 있는 테이블 — 그 테이블의 제약을 강조하고, 방향 필터의 기준이 된다. */
  activeTable: TableRef | null
  onPickTable: (t: TableDef) => void
  filter: KindFilter
  onFilterChange: (f: KindFilter) => void
  /** 켜면 **이 표를 가리키는** 제약만 — 나가는 참조가 아니라 들어오는 참조. */
  incomingOnly: boolean
  onIncomingOnlyChange: (v: boolean) => void
}) {
  const all = flattenConstraints(tables)
  const counts = countByKind(all)
  const incomingCount = activeTable ? filterIncoming(all, activeTable).length : 0
  const byDirection = incomingOnly ? filterIncoming(all, activeTable) : all
  const groups = groupConstraintsByTable(filterByKind(byDirection, filter))
  const pick = (name: string): void => {
    const t = tables.find((x) => x.name === name)
    if (t) onPickTable(t)
  }
  /**
   * 복사 글자는 **원본 제약에서** 만든다 — 이 패널이 든 납작한 줄(`FlatConstraint`)로 따로 지으면
   * 같은 제약을 상세 화면과 다르게 적게 된다. 못 찾으면 빈 배열이고, 그러면 메뉴가 안 뜬다.
   */
  const copyItemsOf = (c: { table: string; schema?: string; name: string }): CopyItem[] => {
    const t = tables.find((x) => sameTable(x, { schema: c.schema, name: c.table }))
    const con = t?.constraints.find((k) => k.name === c.name)
    return t && con ? constraintCopyItems(t, con) : []
  }
  const tableOf = (name: string, schema?: string): TableDef | undefined =>
    tables.find((x) => sameTable(x, { schema, name }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
        {KIND_FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            data-constraint-filter={k}
            onClick={() => onFilterChange(k)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10.5px] font-semibold outline-none',
              filter === k ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg'
            )}
          >
            {k === 'ALL' ? 'ALL' : k.toUpperCase()} {counts[k]}
          </button>
        ))}
      </div>

      {/*
        방향 필터 — 종류 칩과 **같은 줄에 안 섞는다.** 종류는 "무엇이냐", 이것은 "어디를 향하냐"라
        축이 달라서, 한 줄에 두면 `FK` 와 `← 이 표` 가 서로 배타로 보인다(실제로는 같이 걸린다).
        보고 있는 표가 없으면 기준이 없으니 줄 자체를 안 그린다.
      */}
      {activeTable && (
        <div className="border-b border-line px-2 py-1.5">
          <button
            type="button"
            data-constraint-incoming={incomingOnly ? 'on' : 'off'}
            aria-pressed={incomingOnly}
            onClick={() => onIncomingOnlyChange(!incomingOnly)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10.5px] font-semibold outline-none',
              incomingOnly ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg'
            )}
            title={`${activeTable.name} 을 가리키는 제약만 보기`}
          >
            ← 이 표 {incomingCount}
          </button>
        </div>
      )}

      {/* 테이블별 그룹(Header) > 그 테이블 제약들 — 같은 테이블 제약을 한 묶음으로 본다. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map((g) => {
          const gTable = tableOf(g.table, g.constraints[0]?.schema)
          return (
            <div key={g.table}>
              <CopyMenu items={gTable ? tableCopyItems(gTable) : []}>
                <button
                  type="button"
                  data-constraint-group={g.table}
                  onClick={() => pick(g.table)}
                  title={`${g.table} 테이블 보기`}
                  className={cn(
                    'sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-left outline-none hover:bg-panel-strong',
                    activeTable &&
                      sameTable({ schema: g.constraints[0]?.schema, name: g.table }, activeTable) &&
                      'text-accent'
                  )}
                >
                  <Table2 className="size-3.5 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">{g.table}</span>
                  <span className="shrink-0 text-[10.5px] text-muted">{g.constraints.length}</span>
                </button>
              </CopyMenu>
              {g.constraints.map((c) => (
                <CopyMenu key={c.id} items={copyItemsOf(c)}>
                  <button
                    type="button"
                    data-constraint-row={c.name}
                    onClick={() => pick(c.table)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-line/50 py-1.5 pl-6 pr-3 text-left outline-none hover:bg-panel',
                      activeTable && sameTable({ schema: c.schema, name: c.table }, activeTable) && 'bg-accent-soft/30'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <KindBadge kind={c.kind} />
                      <span className="min-w-0 truncate font-mono text-[11.5px] text-fg">{c.name}</span>
                    </span>
                    {/* CHECK 는 컬럼에 안 매인다 — 그 자리에 조건식을 보인다(비면 줄 자체를 뺀다). */}
                    {(c.kind === 'check' ? c.expression : c.columns.join(', ')) && (
                      <span className="min-w-0 truncate font-mono text-[10.5px] text-muted">
                        {c.kind === 'check' ? c.expression : c.columns.join(', ')}
                      </span>
                    )}
                    {c.refLabel && (
                      <span className="min-w-0 truncate font-mono text-[10.5px] text-accent">{c.refLabel}</span>
                    )}
                  </button>
                </CopyMenu>
              ))}
            </div>
          )
        })}
        {groups.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-muted">
            {incomingOnly ? '이 표를 가리키는 제약 없음' : '제약 없음'}
          </div>
        )}
      </div>
    </div>
  )
}

/** 제약 종류 배지 — 종류별 색만 다르고 표기는 텍스트(서비스 공통 규칙: 이모지 금지). */
export function KindBadge({ kind }: { kind: Constraint['kind'] }) {
  const color: Record<Constraint['kind'], string> = {
    pk: 'bg-amber-100 text-amber-700',
    fk: 'bg-sky-100 text-sky-700',
    uk: 'bg-emerald-100 text-emerald-700',
    idx: 'bg-violet-100 text-violet-700',
    check: 'bg-rose-100 text-rose-700'
  }
  return (
    <span className={cn('shrink-0 rounded px-1 text-[9px] font-bold uppercase', color[kind])}>{kind}</span>
  )
}
