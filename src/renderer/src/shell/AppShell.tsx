import { Titlebar } from './Titlebar'
import { TabBar } from './TabBar'
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
 *   L0 탭 줄(항상 — 지금 열어 둔 자리들) → L1 레일(항상) → L2 모듈탭(항상) →
 *   L3 뷰탭(뷰나 구획 손잡이가 있을 때 — 판단은 ViewTabs 자신이) →
 *   L4 툴바(leaf 에 Toolbar 있을 때) → 워크스페이스
 *
 * 탭 줄만 **레일보다 위, 폭 전체**에 선다. 탭은 서비스를 가로질러 섞이므로(DB 탭 옆에 API 탭)
 * 서비스 레일 안에 가둘 수 없다 — 브라우저에서 탭 줄이 창 맨 위에 있는 것과 같은 이유다.
 */
export function AppShell() {
  const { service, leaf } = useActive()

  const Toolbar = leaf.Toolbar
  const Workspace = leaf.workspace
  const Overlay = service.Overlay

  return (
    <div className="flex h-screen flex-col bg-canvas text-fg">
      <Titlebar />
      <TabBar />

      <div className="flex min-h-0 flex-1">
        <ActivityRail />

        <div className="flex min-w-0 flex-1 flex-col">
          <ContextBar />
          <ModuleTabs />
          <ViewTabs />
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
