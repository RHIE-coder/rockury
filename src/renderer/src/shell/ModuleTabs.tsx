import { Fragment } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import type { ModuleArea } from '../nav/types'
import { cx } from '../lib/cx'

/**
 * 구획 그룹 칩(badge). area 전환 지점에 렌더된다. common 은 칩 없이 구분선만.
 * 설계=Mercury 시안, 운영=테라코타 — globals.css 팔레트로 두 부서에 색 정체성 부여.
 */
const AREA_CHIP: Partial<Record<ModuleArea, { label: string; cls: string }>> = {
  design: { label: '설계', cls: 'bg-accent-soft text-accent' },
  ops: { label: '운영', cls: 'bg-accent-2-soft text-accent-2' }
}

/** L2 — 서비스 내부 모듈 탭 (상단 1차, 활성 = 다크 pill). area 전환 지점에 구분선. */
export function ModuleTabs() {
  const { service, module } = useActive()
  const selectModule = useNav((s) => s.selectModule)

  return (
    <Tabs.Root value={module.id} onValueChange={selectModule} className="shrink-0">
      <Tabs.List
        aria-label="모듈"
        className="flex items-center gap-1 overflow-x-auto border-b border-line bg-canvas px-3 py-2"
      >
        {service.modules.map((m, i) => {
          const Icon = m.icon
          const area: ModuleArea = m.area ?? 'common'
          const prevArea: ModuleArea = i > 0 ? service.modules[i - 1].area ?? 'common' : area
          const showDivider = i > 0 && area !== prevArea
          const chip = AREA_CHIP[area]

          return (
            <Fragment key={m.id}>
              {showDivider && (
                <span aria-hidden className="flex shrink-0 items-center gap-2 pl-1 pr-0.5">
                  <span className="h-4 w-px bg-line" />
                  {chip && (
                    <span
                      className={cx(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                        chip.cls
                      )}
                    >
                      {chip.label}
                    </span>
                  )}
                </span>
              )}
              <Tabs.Trigger
                value={m.id}
                // surface-verify 자동 순회 훅(전 모듈 캡처) — 지우면 UI 게이트가 화면을 잃는다.
                data-nav-module={m.id}
                className={cx(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  'text-muted hover:bg-panel-strong hover:text-fg',
                  'data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:hover:bg-accent'
                )}
              >
                <Icon size={16} />
                {m.label}
              </Tabs.Trigger>
            </Fragment>
          )
        })}
      </Tabs.List>
    </Tabs.Root>
  )
}
