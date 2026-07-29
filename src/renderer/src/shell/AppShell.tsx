import { Titlebar } from './Titlebar'
import { ActivityRail } from './ActivityRail'
import { ContextBar } from './ContextBar'
import { ModuleTabs } from './ModuleTabs'
import { ViewTabs } from './ViewTabs'
import { ContextualToolbar } from './ContextualToolbar'
import { useActive } from '../nav/useNav'
import { DevFeedback } from '../devtools/feedback'

/**
 * Rockury 공통 레이아웃 셸.
 *
 * 활성 경로를 걸으며 존재하는 계층만 렌더한다:
 *   L1 레일(항상) → L2 모듈탭(항상) → L3 뷰탭(모듈에 views 있을 때) →
 *   L4 툴바(leaf 에 Toolbar 있을 때) → 워크스페이스
 */
export function AppShell() {
  const { service, module, leaf } = useActive()

  const hasViews = Boolean(module.views?.length)
  const Toolbar = leaf.Toolbar
  const Workspace = leaf.workspace
  const Overlay = service.Overlay

  return (
    <div className="flex h-screen flex-col bg-canvas text-fg">
      <Titlebar />

      <div className="flex min-h-0 flex-1">
        <ActivityRail />

        <div className="flex min-w-0 flex-1 flex-col">
          <ContextBar />
          <ModuleTabs />
          {hasViews && <ViewTabs />}
          {Toolbar && (
            <ContextualToolbar>
              <Toolbar />
            </ContextualToolbar>
          )}

          <main className="min-h-0 flex-1 overflow-hidden">
            {Workspace ? <Workspace /> : null}
          </main>
        </div>
      </div>

      {/* 서비스 전역 오버레이(모달 등) — 예: DB 의 새 설계 모달 */}
      {Overlay && <Overlay />}

      {/* 개발용 화면 피드백 도구. 빌드 시 상수로 접혀 배포본·e2e 에는 아예 없다. */}
      {import.meta.env.DEV && <DevFeedback />}
    </div>
  )
}
