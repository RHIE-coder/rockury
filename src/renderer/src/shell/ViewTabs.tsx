import * as Tabs from '@radix-ui/react-tabs'
import { useActive, useNav } from '../nav/useNav'
import { cx } from '../lib/cx'

/**
 * L3 — 모듈 내부 뷰 탭 (상단 2차, 활성 = 밑줄).
 * 활성 모듈에 views 가 없으면 AppShell 이 이 컴포넌트를 렌더하지 않는다.
 */
export function ViewTabs() {
  const { module, view } = useActive()
  const selectView = useNav((s) => s.selectView)

  if (!module.views?.length || !view) return null

  return (
    <Tabs.Root value={view.id} onValueChange={selectView} className="shrink-0">
      <Tabs.List
        aria-label="뷰"
        className="flex items-center gap-5 overflow-x-auto border-b border-line bg-canvas px-4"
      >
        {module.views.map((v) => {
          const Icon = v.icon
          return (
            <Tabs.Trigger
              key={v.id}
              value={v.id}
              className={cx(
                'flex shrink-0 items-center gap-1.5 border-b-2 border-transparent py-2.5 text-[13px] font-medium transition-colors',
                'text-muted hover:text-fg',
                'data-[state=active]:border-accent data-[state=active]:text-fg'
              )}
            >
              <Icon size={15} />
              {v.label}
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>
    </Tabs.Root>
  )
}
