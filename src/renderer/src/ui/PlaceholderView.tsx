import type { LucideIcon } from 'lucide-react'
import { cx } from '../lib/cx'

interface PlaceholderViewProps {
  title: string
  subtitle?: string
  /** 예: "depth 2 · DB › Overview" — 현재 경로/깊이를 배지로 표시 */
  depth?: string
  icon?: LucideIcon
  className?: string
}

/** 아직 구현 전인 워크스페이스를 위한 공용 빈 상태 화면. */
export function PlaceholderView({
  title,
  subtitle,
  depth,
  icon: Icon,
  className
}: PlaceholderViewProps) {
  return (
    <div
      className={cx(
        'flex h-full flex-col items-center justify-center gap-3 px-8 text-center',
        className
      )}
    >
      {Icon && (
        <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
          <Icon size={24} strokeWidth={1.8} />
        </div>
      )}
      {/*
        칩 배경이 `panel-strong` 이면 `muted` 글자가 **4.35:1** 로 AA 에 못 미친다(실측).
        테두리로 모양을 유지하고 배경만 캔버스로 내려 5.06:1 을 만든다.
      */}
      {depth && (
        <span className="rounded-full border border-line bg-canvas px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-muted">
          {depth}
        </span>
      )}
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {subtitle && <p className="max-w-md text-[13px] leading-relaxed text-muted">{subtitle}</p>}
    </div>
  )
}
