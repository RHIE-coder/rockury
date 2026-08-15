import { ArrowDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ClipToggle, clipBox, useClipped } from '@renderer/ui/clipped'
import { fkTargetLabel } from './fkPolicy'
import { FkPolicyChips } from './FkPolicyChips'
import type { Constraint, ResolvedConstraintColumn } from './types'

/**
 * 제약 한 줄의 **구조화 표기** — 설계부(Definition)와 운영부(Migration 대조표)가 공유하는
 * 하나뿐인 그림. 컬럼 순번 · 정렬 방향 · FK 참조처 · ON DELETE/ON UPDATE 정책을 구조에서 그대로 그린다.
 *
 * 왜 컴포넌트로 뽑았나: 대조표는 같은 내용을 문자열 한 줄로 찍고 있었는데(`(a) → t(id)`),
 * 거기엔 **정책이 아예 없었다** — 같은 제약을 두 화면이 다르게 말하면 어느 쪽이 진실인지
 * 사람이 판정해야 한다(2026-08-11 사용자: "UPDATE, DELETE 정책은?").
 *
 * 컬럼은 **이미 이름으로 풀린 것**을 받는다 — 푸는 쪽이 화면마다 다르기 때문이다
 * (설계부는 활성 테이블, 대조표는 사라지는 줄이면 before 쪽 컬럼으로 풀어야 한다).
 */
export function ConstraintShape({
  con,
  cols,
  emptyText,
  className
}: {
  con: Constraint
  cols: ResolvedConstraintColumn[]
  /** 컬럼이 하나도 안 걸렸을 때 대신 보일 말. 없으면 아무것도 안 그린다. */
  emptyText?: string
  className?: string
}) {
  // CHECK 은 컬럼에 안 매인다 — 식이 본체다. 조건식은 길어서 제일 잘 잘리는 자리다.
  // 훅은 조건 앞에서 부른다(아래 이른 반환보다 먼저) — 훅 순서는 렌더마다 같아야 한다.
  const expr = useClipped<HTMLSpanElement>(con.expression ?? '')
  if (con.kind === 'check') {
    return (
      <span className={cn('flex min-w-0 items-start gap-0.5', className)}>
        <span
          ref={expr.ref}
          className={cn('min-w-0 flex-1 font-mono text-[12px] text-muted', clipBox(expr.expanded))}
        >
          {con.expression || '—'}
        </span>
        {expr.clipped && <ClipToggle expanded={expr.expanded} onToggle={expr.toggle} className="mt-0" />}
      </span>
    )
  }

  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      {cols.length === 0 && emptyText && <span className="text-[12px] text-muted/60">{emptyText}</span>}
      {cols.map((c, i) => (
        <span
          key={`${i}:${c.name}`}
          className="flex shrink-0 items-center gap-1 rounded bg-panel-strong px-1.5 py-0.5 font-mono text-[11px] text-fg"
        >
          {/* 순번은 **복합일 때만** 붙인다 — 컬럼 하나짜리에 "1" 을 달면 뜻 없는 숫자가 는다. */}
          {cols.length > 1 && <span className="font-semibold text-muted">{i + 1}</span>}
          {c.name}
          {c.direction === 'DESC' && <ArrowDown className="size-3 text-muted" />}
        </span>
      ))}
      {con.kind === 'fk' && (
        <>
          <span className="shrink-0 text-[12px] text-accent-2">→</span>
          <span className="shrink-0 font-mono text-[11px] text-accent">{fkTargetLabel(con)}</span>
          <FkPolicyChips con={con} />
        </>
      )}
    </span>
  )
}
