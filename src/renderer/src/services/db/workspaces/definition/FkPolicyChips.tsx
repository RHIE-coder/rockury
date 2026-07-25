import { cn } from '@renderer/lib/utils'
import { fkPolicyChips } from './fkPolicy'
import type { Constraint } from './types'

/**
 * FK 정책 칩(ON DELETE / ON UPDATE) — 설계부·운영부가 공유하는 **하나뿐인** FK 정책 표기.
 * 둘 다 항상 그린다. 지정 안 했거나 NO ACTION 인 쪽은 흐리게(특별한 정책이 아님).
 * 새 화면에서 FK 정책을 보여줄 일이 생기면 직접 그리지 말고 이 컴포넌트를 쓴다.
 */
export function FkPolicyChips({ con, className }: { con: Constraint; className?: string }) {
  return (
    <>
      {fkPolicyChips(con).map((p) => (
        <span
          key={p.kind}
          title={p.hint}
          className={cn(
            'shrink-0 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[10px] leading-[1.5]',
            p.implicit ? 'text-muted/60' : 'text-fg',
            className
          )}
        >
          {p.label}
        </span>
      ))}
    </>
  )
}
