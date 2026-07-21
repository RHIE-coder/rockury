import { Settings } from 'lucide-react'
import { registry } from '../nav/registry'
import { useNav } from '../nav/useNav'
import { cx } from '../lib/cx'

/** L1 — 서비스 전환용 좌측 세로 레일. */
export function ActivityRail() {
  const serviceId = useNav((s) => s.serviceId)
  const selectService = useNav((s) => s.selectService)

  return (
    <nav
      aria-label="서비스"
      className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3"
    >
      {registry.map((service) => {
        const Icon = service.icon
        const active = service.id === serviceId
        return (
          <button
            key={service.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => selectService(service.id)}
            className={cx(
              'relative flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors',
              active
                ? "bg-accent-soft text-accent before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-accent before:content-['']"
                : 'text-muted hover:bg-panel-strong hover:text-fg'
            )}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            <span className="leading-none">{service.label}</span>
          </button>
        )
      })}

      <button
        type="button"
        aria-label="설정"
        title="설정 (준비 중)"
        className="mt-auto flex size-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-panel-strong hover:text-fg"
      >
        <Settings size={19} strokeWidth={1.8} />
      </button>
    </nav>
  )
}
