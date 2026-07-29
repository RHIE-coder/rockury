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
            // surface-verify 가 전 서비스를 자동 순회하는 안정 훅 — 지우면 UI 게이트가 화면을 잃는다.
            data-nav-service={service.id}
            aria-current={active ? 'page' : undefined}
            onClick={() => selectService(service.id)}
            className={cx(
              'relative flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-[background-color,color,box-shadow,transform] duration-100',
              active
                ? // 활성은 accent 원색으로 꽉 채운다(연한 칠 + 좌측 막대 → 진한 채움).
                  // 입체감은 세 겹 그림자로 만든다: 윗면 하이라이트 / 아랫면 그림자(안쪽) + 바닥 그림자(바깥).
                  // 눌리면 1px 내려앉고 그림자가 줄어 "실제로 눌린" 느낌을 준다.
                  'bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.18),0_2px_4px_-1px_rgba(14,116,144,0.45)] active:translate-y-px active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.22)]'
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
