import { useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { ConstraintListPanel } from './ConstraintListPanel'
import { TableListPanel } from './TableListPanel'
import { flattenConstraints } from './console/constraintsView'
import type { KindFilter } from './console/constraintsView'
import type { TableDef } from './workspaces/definition/types'

/**
 * 사이드 패널 — [테이블/뷰 목록 | 제약 목록] 탭. Studio·Console 의 Definition·Diagram·Data 가
 * **같은 사이드바를 쓰도록** 묶은 곳(원형은 Console › Data 사이드바).
 * 제약 항목을 누르면 그 제약이 걸린 테이블로 이동한다 — 제약에서 테이블을 찾아가는 길.
 */
export function TableSidePanel({
  tables,
  activeId,
  onPick,
  searchPlaceholder,
  rowExtra,
  emptyText,
  footer
}: {
  tables: TableDef[]
  activeId: string | null
  onPick: (t: TableDef) => void
  searchPlaceholder?: string
  rowExtra?: (t: TableDef) => ReactNode
  emptyText?: string
  footer?: ReactNode
}) {
  const [tab, setTab] = useState<'tables' | 'constraints'>('tables')
  const [filter, setFilter] = useState<KindFilter>('ALL')

  const constraintCount = flattenConstraints(tables).length
  const activeName = tables.find((t) => t.id === activeId)?.name ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        {/* 라벨이 `테이블` 이면 바로 아래 구역 머리(`테이블 4` · `뷰 1`)와 개수가 어긋나 보인다 —
            이 탭은 둘을 다 담으므로 이름도 둘을 다 말한다. */}
        <TabButton active={tab === 'tables'} onClick={() => setTab('tables')} testId="tables">
          테이블·뷰 <span className="opacity-70">{tables.length}</span>
        </TabButton>
        <TabButton active={tab === 'constraints'} onClick={() => setTab('constraints')} testId="constraints">
          제약 <span className="opacity-70">{constraintCount}</span>
        </TabButton>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'tables' ? (
          <TableListPanel
            tables={tables}
            activeId={activeId}
            onPick={onPick}
            searchPlaceholder={searchPlaceholder}
            rowExtra={rowExtra}
            emptyText={emptyText}
            footer={footer}
          />
        ) : (
          <ConstraintListPanel
            tables={tables}
            activeTableName={activeName}
            onPickTable={onPick}
            filter={filter}
            onFilterChange={setFilter}
          />
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  testId,
  children
}: {
  active: boolean
  onClick: () => void
  testId: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      // e2e 가 탭을 이름이 아니라 역할로 집게 하는 훅 — 지우면 스모크가 깨진다.
      data-side-tab={testId}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded px-2.5 py-1 text-[12px] font-medium outline-none',
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}
