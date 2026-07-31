import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { EyeOff, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { TableRef } from '../../schemaRef'
import type { OutsideKind } from '../outsideRef'

export interface OutsideNodeData {
  target: TableRef
  kind: OutsideKind
  /** 화면이 이 층을 뭐라 부르나 — PostgreSQL 은 "스키마", MySQL 은 "데이터베이스". */
  schemaLabel: string
  /** 켤 수 있는 대상이면 눌렀을 때 범위에 더한다. 없으면 누를 것이 없다. */
  onAdd?: (schema: string) => void
  [key: string]: unknown
}

/**
 * **범위 밖 대상 카드** — 지금 화면에 없는 테이블을 가리키는 FK 의 도착점(§db-remote.scope R3).
 *
 * 컬럼을 안 그린다: 읽지 않았으니 **모른다**. 모르는 것을 빈 칸으로라도 그리면 "컬럼이 없는
 * 테이블"로 읽힌다. 테두리를 점선으로 두고 이름만 든다 — 실물 노드와 한눈에 갈린다.
 *
 * 켤 수 있는 대상이면 카드 자체가 그 스키마를 범위에 더하는 단추다. 켤 수 없으면 왜인지 말한다.
 */
export const OutsideErdNode = memo(function OutsideErdNode({ data }: { data: OutsideNodeData }) {
  const { target, kind, schemaLabel, onAdd } = data
  const addable = kind === 'addable' && !!target.schema && !!onAdd

  return (
    <div
      role={addable ? 'button' : undefined}
      tabIndex={addable ? 0 : undefined}
      onClick={() => addable && onAdd!(target.schema!)}
      onKeyDown={(e) => addable && (e.key === 'Enter' || e.key === ' ') && onAdd!(target.schema!)}
      data-outside-node={target.schema ? `${target.schema}.${target.name}` : target.name}
      title={
        addable
          ? `범위 밖 ${schemaLabel} "${target.schema}" — 눌러서 이 화면에 더해요`
          : `이 연결에서 고를 수 없는 ${schemaLabel}예요 — 권한이 없거나 사라졌어요`
      }
      className={cn(
        'min-w-[150px] rounded-lg border-2 border-dashed bg-canvas/80 px-2.5 py-2 transition-colors',
        addable
          ? 'cursor-pointer border-accent/50 hover:border-accent hover:bg-accent-soft'
          : 'cursor-default border-line'
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-1.5 !rounded-sm !border-none !bg-muted" />

      <div className="flex items-center gap-1.5">
        <EyeOff className={cn('size-3 shrink-0', addable ? 'text-accent' : 'text-muted')} />
        <span className="truncate font-mono text-[12px] font-semibold text-fg">
          {target.schema && <span className="text-muted">{target.schema}.</span>}
          {target.name}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
        {addable ? (
          <>
            <Plus className="size-2.5 text-accent" />
            <span>범위에 더하기</span>
          </>
        ) : (
          <span>고를 수 없는 {schemaLabel}</span>
        )}
      </div>
    </div>
  )
})
