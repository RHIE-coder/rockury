import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown } from 'lucide-react'
import { useActive } from '../nav/useNav'
import type { ContextSelector, ModuleArea } from '../nav/types'
import { cx } from '../lib/cx'
import { HintChip, SelectorMenu, useSelector } from './contextSelector'

/**
 * L1.5 — 서비스 전역 컨텍스트 바.
 *
 * 서비스가 `context` 셀렉터를 선언하고 **그중 `area` 가 없는 것이 있을 때만** 렌더된다.
 * `area` 가 붙은 셀렉터는 이 바가 아니라 뷰 탭 줄 오른쪽 끝의 구획 손잡이로 간다
 * (DB 가 그 경우 — 설계·시점·연결·범위 넷 다 손잡이로 가서 이 바가 통째로 사라졌다).
 *
 * nav 트리(모듈/뷰)와 별개로 "지금 어느 대상 기준으로 보는가"를 고르는 ambient 상태이며,
 * `activeInAreas` 로 특정 구획에서만 활성화된다.
 * 옵션이 런타임 데이터인 셀렉터는 `nav/contextOptions` 레지스트리가 정적 옵션을 대체한다.
 */
// `whitespace-nowrap` — 손잡이와 같은 바닥선(`AreaHandle`): 자리가 모자라면 가로로 줄어들지
// 세로로 자라면 안 된다. 두 어절짜리 라벨이 줄바꿈되면 이 바 하나가 통째로 높아진다.
const chip =
  'flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] transition'

function isEnabled(sel: ContextSelector, area: ModuleArea): boolean {
  return !sel.activeInAreas || sel.activeInAreas.includes(area)
}

export function ContextBar() {
  const { service, module } = useActive()

  // 구획 뱃지로 간 셀렉터는 여기 그리지 않는다. 남는 게 없으면 바 자체가 없다.
  const selectors = service.context?.filter((s) => !s.area)
  if (!selectors?.length) return null

  const area: ModuleArea = module.area ?? 'common'

  return (
    <Tooltip.Provider delayDuration={200}>
      <div
        // e2e 가 "이 서비스에 바가 있나/없나"를 크기·색이 아니라 역할로 집게 하는 훅
        // (L4 도구줄이 같은 h-11/bg-panel 을 쓴다 — 클래스로 세면 도구줄을 바로 오인한다).
        data-context-bar
        className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-4"
      >
        {selectors.map((sel) => (
          <BarSelector key={sel.id} sel={sel} enabled={isEnabled(sel, area)} />
        ))}
      </div>
    </Tooltip.Provider>
  )
}

function BarSelector({ sel, enabled }: { sel: ContextSelector; enabled: boolean }) {
  const state = useSelector(sel)
  const { current } = state
  const Icon = sel.icon

  const face = (
    <>
      {Icon && <Icon size={14} className="text-muted" />}
      <span className="text-muted">{sel.label}</span>
      {current ? (
        <>
          <span className="font-medium text-fg">{current.label}</span>
          <HintChip hint={current.hint} dot={current.dot} />
        </>
      ) : (
        <span className="italic text-muted">{sel.placeholder ?? 'Select…'}</span>
      )}
      <ChevronDown size={13} className="text-muted" />
    </>
  )

  if (!enabled) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className={cx(chip, 'cursor-not-allowed opacity-40')}>{face}</div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="z-50 rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-white shadow-md"
          >
            운영부 모듈에서만 선택할 수 있어요
            <Tooltip.Arrow className="fill-ink" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    )
  }

  return (
    <SelectorMenu
      sel={sel}
      state={state}
      trigger={
        <button
          type="button"
          title={current?.subtitle || undefined}
          className={cx(
            chip,
            'text-fg hover:bg-panel-strong data-[state=open]:bg-panel-strong',
            // 값 없으면 흐리게(비활성 Env 와 동일 톤). 클릭 가능하니 hover/열림 시 진해짐.
            !current && 'opacity-40 hover:opacity-100 data-[state=open]:opacity-100'
          )}
        >
          {face}
        </button>
      }
    />
  )
}
