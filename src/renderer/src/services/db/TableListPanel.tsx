import { useMemo, useState, type ReactNode } from 'react'
import { Eye, Layers, Search, Table2 } from 'lucide-react'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { SideListEmpty, SideListRow, SideListScroll, SideSectionHeader } from './sideList'
import { groupTablesForList } from './tableList'
import type { TableDef } from './workspaces/definition/types'

/**
 * 테이블 목록 패널 — Design·Remote 의 Definition·Diagram·Data 가 공유하는 **하나뿐인** 목록 표현.
 * 테이블과 뷰(view)를 구역으로 가르고, 여러 스키마가 섞여 있으면 스키마로 한 겹 더 묶는다.
 */
export function TableListPanel({
  tables,
  activeId,
  onPick,
  searchPlaceholder,
  rowExtra,
  emptyText = '테이블 없음'
}: {
  tables: TableDef[]
  activeId: string | null
  onPick: (t: TableDef) => void
  /** 주면 검색창을 그린다. 없으면 검색 없이 목록만. */
  searchPlaceholder?: string
  /** 행 오른쪽 끝 추가 표식(예: 편집 불가 자물쇠). */
  rowExtra?: (t: TableDef) => ReactNode
  emptyText?: string
}) {
  const [q, setQ] = useState('')
  const g = useMemo(() => groupTablesForList(tables, q), [tables, q])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {searchPlaceholder && (
        <div className="relative shrink-0 px-2.5 pb-1.5 pt-2.5">
          <Search size={13} className="absolute left-[18px] top-1/2 -translate-y-[3px] text-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-7 pl-7 text-[12px]"
          />
        </div>
      )}

      <SideListScroll>
        {g.shown === 0 ? (
          <SideListEmpty>{g.total === 0 ? emptyText : '검색 결과 없음'}</SideListEmpty>
        ) : (
          g.groups.map((grp, gi) => (
            <div key={grp.schema || '·'}>
              {/* 스키마가 섞여 있을 때만 머리를 그린다 — 하나뿐이면 시끄럽다. */}
              {g.multiSchema && (
                <SchemaHeader
                  schema={grp.schema}
                  count={grp.tables.length + grp.views.length}
                  first={gi === 0}
                />
              )}
              {grp.tables.length > 0 && (
                <SideSectionHeader
                  icon={Table2}
                  label="테이블"
                  count={grp.tables.length}
                  first={gi === 0 && !g.multiSchema}
                />
              )}
              {grp.tables.map((t) => (
                <TableListRow
                  key={t.id}
                  table={t}
                  active={t.id === activeId}
                  onPick={() => onPick(t)}
                  extra={rowExtra?.(t)}
                />
              ))}
              {grp.views.length > 0 && (
                <SideSectionHeader
                  icon={Eye}
                  label="뷰"
                  count={grp.views.length}
                  first={grp.tables.length === 0 && gi === 0 && !g.multiSchema}
                />
              )}
              {grp.views.map((t) => (
                <TableListRow
                  key={t.id}
                  table={t}
                  active={t.id === activeId}
                  onPick={() => onPick(t)}
                  extra={rowExtra?.(t)}
                />
              ))}
            </div>
          ))
        )}
      </SideListScroll>
    </div>
  )
}

/**
 * 스키마 머리 — 여러 스키마가 한 목록에 있을 때만 그린다.
 * 테이블/뷰 머리보다 진하게 둔다: 이름이 겹치는 테이블을 가르는 것이 여기라, 이 줄이 안 보이면
 * 목록이 "이름순이 깨진 한 덩어리"로 읽힌다.
 */
function SchemaHeader({ schema, count, first }: { schema: string; count: number; first?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 pb-1 font-mono text-[11px] font-bold text-fg',
        first ? 'pt-2' : 'mt-2 border-t-2 border-line pt-2.5'
      )}
    >
      <Layers className="size-3 text-accent" />
      {schema || '기본'}
      <span className="font-sans text-[10.5px] font-semibold text-muted">{count}</span>
    </div>
  )
}

/** 목록 행 — 종류 아이콘 + 이름 + (추가 표식) + 컬럼 수. */
function TableListRow({
  table,
  active,
  onPick,
  extra
}: {
  table: TableDef
  active: boolean
  onPick: () => void
  extra?: ReactNode
}) {
  return (
    <SideListRow
      icon={table.isView ? Eye : Table2}
      name={table.name}
      count={table.columns.length}
      active={active}
      onPick={onPick}
      extra={extra}
      attrs={{
        // e2e 가 구조(ul/li)에 매이지 않고 이름으로 행을 집게 하는 훅 — 지우면 스모크가 깨진다.
        'data-table-row': table.name,
        // 고른 표는 뷰를 옮겨도 유지돼야 한다(2026-08-04) — 그 "유지"는 색으로만 드러나서,
        // 검사가 클래스 문자열을 뒤지지 않게 훅으로 내놓는다.
        'data-table-active': active ? 'true' : undefined
      }}
    />
  )
}
