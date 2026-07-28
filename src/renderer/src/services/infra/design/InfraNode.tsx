import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from '../catalog/iconMap'

/**
 * 다이어그램 노드 하나.
 *
 * 담는 상자(자식이 있거나 담을 수 있는 종류)는 **속이 비고 테두리만** 그린다 —
 * 안에 자식이 렌더되므로 배경을 채우면 자식이 묻힌다.
 */
export interface InfraNodeData extends Record<string, unknown> {
  label: string
  icon: string
  color?: string
  isBox: boolean
  /** 문서가 비었나 — 채우게 만드는 압력으로 표식을 붙인다. */
  undocumented: boolean
  /** 카탈로그에서 사라진 종류를 가리키나. */
  unknownType: boolean
}

export function InfraNode({ data, selected }: NodeProps): React.JSX.Element {
  const d = data as InfraNodeData
  return (
    <div
      className={cn(
        'h-full w-full rounded-lg border text-[12px] transition-shadow',
        d.isBox ? 'border-dashed bg-transparent' : 'bg-card shadow-sm',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      )}
      style={d.color && !selected ? { borderColor: `${d.color}66` } : undefined}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground" />
      <div
        className={cn(
          'flex items-center gap-1.5 px-2',
          d.isBox ? 'h-8 border-b border-dashed border-inherit' : 'h-full'
        )}
      >
        <span style={{ color: d.color }}>
          <InfraIcon icon={d.icon} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{d.label}</span>
        {d.unknownType && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-800"
            title="이 종류가 지금 카탈로그에 없습니다. 노드는 그대로 살아 있습니다."
          >
            종류 없음
          </span>
        )}
        {d.undocumented && (
          <span
            className="shrink-0 rounded bg-sky-100 px-1 text-[9px] text-sky-800"
            data-undocumented
            title="설명이 비어 있습니다 — 노드 문서에서 채우세요."
          >
            설명 없음
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground" />
    </div>
  )
}
