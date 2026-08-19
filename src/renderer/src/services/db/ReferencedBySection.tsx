import { useMemo } from 'react'
import { Badge } from '@renderer/ui/badge'
import { cn } from '@renderer/lib/utils'
import { displayName, hasMultipleSchemas, referencingTables, type TableRef } from './schemaRef'
import { resolveColumns } from './workspaces/definition/derive'
import type { TableDef } from './workspaces/definition/types'

/**
 * "이 테이블을 참조하는 곳" — **들어오는** FK 목록(남 → 나).
 *
 * 왜 필요했나: 화면은 여태 **나가는** 참조(나 → 남)만 보였다. 제약 목록에 `→ users (id)` 가
 * 있으니 users 쪽에서 "누가 나를 가리키나"를 보려면 전 테이블의 제약을 눈으로 훑는 수밖에
 * 없었다(2026-08-19 사용자). 지우기 전에 무엇이 깨지는지도 이 목록이 답이다.
 *
 * 상세 부품 셋(`TableForm`·`TableDetail`·`EditableTableDetail`)이 함께 쓴다 —
 * Diagram 의 상세 서랍이 그 셋을 그대로 불러 쓰므로 화면 넷에 같은 목록이 선다.
 *
 * **자기참조는 뺀다.** 자기 자신을 가리키는 FK 는 이미 위쪽 제약 목록에 서 있어서,
 * 여기 또 넣으면 같은 줄을 한 화면에서 두 번 말하게 된다.
 */
export function ReferencedBySection({
  table,
  tables,
  onJump
}: {
  table: TableDef
  /** 견줄 테이블들 — 이 화면이 이미 들고 있는 목록 그대로. */
  tables: readonly TableDef[]
  /** 참조하는 테이블로 이동. 없으면 줄이 눌리지 않는다(읽기만). */
  onJump?: (target: TableRef) => void
}) {
  const incoming = useMemo(
    () => referencingTables(tables, table).filter((r) => r.table.id !== table.id),
    [tables, table]
  )
  // 스키마가 섞인 화면에서만 이름 앞에 스키마를 붙인다 — 늘 붙이면 단일 스키마에서 시끄럽다.
  const multi = useMemo(() => hasMultipleSchemas(tables), [tables])

  if (incoming.length === 0) return null

  return (
    <div className="mt-4" data-referenced-by={incoming.length}>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Referenced by</span>
        <span className="text-[11px] tabular-nums text-muted">{incoming.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {incoming.map(({ table: from, constraint }) => {
          const cols = resolveColumns(from, constraint).map((r) => r.name)
          const label = displayName(from, multi)
          return (
            <button
              key={`${from.id}:${constraint.id}`}
              type="button"
              // e2e 가 구조 대신 이 훅으로 집는다 — 값은 참조해 오는 테이블 이름.
              data-referenced-from={from.name}
              disabled={!onJump}
              onClick={() => onJump?.(from)}
              title={onJump ? `${label} 로 이동` : undefined}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-left text-[12px] outline-none',
                onJump && 'hover:bg-panel focus-visible:ring-[3px] focus-visible:ring-ring/50'
              )}
            >
              <span className="text-accent-2">←</span>
              <span className={cn('font-mono', onJump ? 'text-accent' : 'text-fg')}>{label}</span>
              {cols.length > 0 && <span className="font-mono text-muted">({cols.join(', ')})</span>}
              <Badge variant="fk" className="px-1.5 py-0.5 text-[10px]">
                FK
              </Badge>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted">{constraint.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
