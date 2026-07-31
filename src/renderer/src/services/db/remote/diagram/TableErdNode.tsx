import { memo, useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { KeyRound } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ConstraintKind, TableDef } from '../../workspaces/definition/types'
import { columnKeyKinds } from '../introspection'

/** xyflow 노드 data 계약 — 뷰가 buildErd 노드를 이 형태로 접어 넣는다. */
export interface TableErdNodeData {
  table: TableDef
  selected: boolean
  /** 강조(선택 테이블과 직접 연결된 이웃). */
  highlighted: boolean
  /** 검색어에 매칭됨. */
  matched: boolean
  /** 검색 활성 중 비매칭 → 흐리게. */
  dimmed: boolean
  /** 간략 보기 — 컬럼 목록을 접고 헤더+개수만. */
  compact: boolean
  /** 편집 모드(Design) — 모든 컬럼에서 관계선을 끌 수 있게 source 핸들을 노출. */
  editable?: boolean
  [key: string]: unknown
}

/** 키 종류별 배지 색 — Badge variant 와 동일 팔레트를 인라인으로. */
const KIND_STYLE: Record<ConstraintKind, string> = {
  pk: 'bg-accent-2-soft text-accent-2',
  fk: 'bg-accent-soft text-accent',
  uk: 'bg-info-soft text-info',
  idx: 'bg-panel-strong text-muted',
  check: 'bg-success-soft text-success'
}

function KindBadges({ kinds }: { kinds: Set<ConstraintKind> }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {[...kinds].sort().map((k) => (
        <span
          key={k}
          className={cn(
            'rounded px-1 text-[9px] font-bold leading-[14px] tracking-wide',
            KIND_STYLE[k]
          )}
        >
          {k.toUpperCase()}
        </span>
      ))}
    </span>
  )
}

function TableErdNodeComponent({ data }: NodeProps) {
  const { table, selected, highlighted, matched, dimmed, compact, editable } = data as unknown as TableErdNodeData
  const kinds = useMemo(() => columnKeyKinds(table), [table])
  // FK 소스 컬럼(엣지가 이 컬럼 행에서 출발) — 핸들 id 로 쓴다.
  const fkCols = useMemo(() => {
    const set = new Set<string>()
    for (const c of table.constraints) {
      if (c.kind === 'fk') for (const ref of c.columns) set.add(ref.columnId)
    }
    return set
  }, [table])

  return (
    <div
      data-erd-compact={compact ? 'true' : undefined}
      data-erd-match={matched ? 'true' : undefined}
      className={cn(
        'min-w-[200px] overflow-hidden rounded-lg border bg-canvas shadow-sm transition-all',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : matched
            ? 'border-accent-2 ring-2 ring-accent-2/40'
            : highlighted
              ? 'border-accent-2 ring-2 ring-accent-2/25'
              : 'border-line',
        dimmed && !selected && 'opacity-30',
        table.isView && 'border-dashed'
      )}
    >
      {/* 들어오는 FK 를 받는 target 핸들(노드 왼쪽, 단일). */}
      <Handle type="target" position={Position.Left} className="!h-3 !w-1.5 !rounded-sm !border-none !bg-accent" />

      {/* 헤더 */}
      <div className={cn('px-2.5 py-1.5', table.isView ? 'bg-info text-white' : 'bg-ink text-white')}>
        <div className="flex items-center gap-1.5">
          {/* 스키마는 이름 앞에 흐리게 — 캔버스에 `entity.card` 와 `public.cards` 가 함께 떠 있을 때
              노드 머리만 보고 어느 쪽인지 알 수 있어야 한다. */}
          <span
            className="flex-1 truncate font-mono text-[13px] font-semibold"
            title={table.schema ? `${table.schema}.${table.name}` : table.name}
          >
            {table.schema && <span className="opacity-55">{table.schema}.</span>}
            {table.name}
          </span>
          {table.isView && (
            <span className="shrink-0 rounded bg-white/20 px-1 text-[8px] font-bold tracking-wider">VIEW</span>
          )}
        </div>
      </div>

      {/* 컬럼 — 간략(compact) 모드에선 개수만 보이고, FK 엣지 앵커는 숨은 핸들로 유지. */}
      {compact ? (
        <>
          <div className="px-2.5 py-1 text-[10px] text-muted">
            {table.columns.length}개 컬럼
            {table.constraints.length > 0 && ` · 제약 ${table.constraints.length}`}
          </div>
          {[...fkCols].map((id) => (
            <Handle
              key={id}
              type="source"
              position={Position.Right}
              id={id}
              className="!size-2 !border-none !bg-accent !opacity-0"
              style={{ right: -4 }}
            />
          ))}
        </>
      ) : (
        <div className="divide-y divide-line/60">
          {table.columns.map((column) => (
            <div key={column.id} className="relative flex items-center gap-1.5 px-2.5 py-0.5 text-[11px]">
              {/* 배지 gutter: 이름 정렬용 최소 40px, 배지가 2개 이상이면(FK+IDX 등) 내용만큼 늘어나 이름을 침범하지 않는다(고정 w-10 은 넘쳐 겹쳤음). */}
              <span className="inline-flex min-w-10 shrink-0 justify-start">
                <KindBadges kinds={kinds.get(column.id) ?? new Set()} />
              </span>
              <span
                className={cn('flex-1 truncate font-mono', column.nullable ? 'text-muted' : 'font-medium text-fg')}
                title={column.name}
              >
                {column.name}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted" title={column.type}>
                {column.type}
              </span>
              {(editable || fkCols.has(column.id)) && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={column.id}
                  className={cn(
                    '!h-2 !w-2 !border-none',
                    fkCols.has(column.id) ? '!bg-accent' : '!bg-line hover:!bg-accent'
                  )}
                  style={{ right: -4 }}
                />
              )}
            </div>
          ))}
          {table.columns.length === 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] italic text-muted">
              <KeyRound className="size-3" /> 컬럼 없음
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const TableErdNode = memo(TableErdNodeComponent)
