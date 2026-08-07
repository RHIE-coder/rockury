import { Table2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  countByKind,
  filterByKind,
  flattenConstraints,
  groupConstraintsByTable,
  KIND_FILTERS,
  type KindFilter
} from './remote/constraintsView'
import type { Constraint, TableDef } from './workspaces/definition/types'

/**
 * 제약 목록 패널 — Definition·Diagram·Data 가 공유하는 **하나뿐인** 제약 목록 표현.
 * 종류 필터(ALL/PK/FK/UK/IDX/CHECK) + 테이블별 그룹. 항목을 누르면 그 테이블로 이동한다.
 * 집계·정렬은 순수 로직(`remote/constraintsView`)이 하고 여기서는 그리기만 한다.
 */
export function ConstraintListPanel({
  tables,
  activeTableName,
  onPickTable,
  filter,
  onFilterChange
}: {
  tables: TableDef[]
  /** 현재 보고 있는 테이블 이름 — 그 테이블의 제약을 강조한다. */
  activeTableName: string | null
  onPickTable: (t: TableDef) => void
  filter: KindFilter
  onFilterChange: (f: KindFilter) => void
}) {
  const all = flattenConstraints(tables)
  const counts = countByKind(all)
  const groups = groupConstraintsByTable(filterByKind(all, filter))
  const pick = (name: string): void => {
    const t = tables.find((x) => x.name === name)
    if (t) onPickTable(t)
  }

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

      {/* 테이블별 그룹(Header) > 그 테이블 제약들 — 같은 테이블 제약을 한 묶음으로 본다. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map((g) => (
          <div key={g.table}>
            <button
              type="button"
              data-constraint-group={g.table}
              onClick={() => pick(g.table)}
              title={`${g.table} 테이블 보기`}
              className={cn(
                'sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-left outline-none hover:bg-panel-strong',
                g.table === activeTableName && 'text-accent'
              )}
            >
              <Table2 className="size-3.5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">{g.table}</span>
              <span className="shrink-0 text-[10.5px] text-muted">{g.constraints.length}</span>
            </button>
            {g.constraints.map((c) => (
              <button
                key={c.id}
                type="button"
                data-constraint-row={c.name}
                onClick={() => pick(c.table)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b border-line/50 py-1.5 pl-6 pr-3 text-left outline-none hover:bg-panel',
                  c.table === activeTableName && 'bg-accent-soft/30'
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
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">제약 없음</div>}
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
