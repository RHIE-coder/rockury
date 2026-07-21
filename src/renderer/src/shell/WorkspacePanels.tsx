import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

interface WorkspacePanelsProps {
  /** 워크스페이스 내부 좌측 서브 사이드바 내용 (전역 크롬과 별개). */
  sidebar: ReactNode
  sidebarTitle?: string
  /** 사이드바 헤더 우측 액션 슬롯 (예: + 버튼). */
  sidebarActions?: ReactNode
  children: ReactNode
  /** 사이드바 기본 너비(%) */
  defaultSize?: number
  autoSaveId?: string
}

/**
 * 워크스페이스 내부의 리사이즈 가능한 [서브 사이드바 | 메인] 분할.
 * depth 와 무관하게 개별 워크스페이스가 자체적으로 사용한다.
 */
export function WorkspacePanels({
  sidebar,
  sidebarTitle,
  sidebarActions,
  children,
  defaultSize = 22,
  autoSaveId
}: WorkspacePanelsProps) {
  return (
    <PanelGroup direction="horizontal" className="h-full" autoSaveId={autoSaveId}>
      <Panel defaultSize={defaultSize} minSize={14} maxSize={42} className="flex flex-col bg-panel">
        {(sidebarTitle || sidebarActions) && (
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
            {sidebarTitle && (
              <span className="text-[12px] font-semibold tracking-wide text-muted">
                {sidebarTitle}
              </span>
            )}
            {sidebarActions}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{sidebar}</div>
      </Panel>

      <PanelResizeHandle
        className={cx(
          'w-px bg-line outline-none transition-colors',
          'hover:bg-accent data-[resize-handle-state=drag]:bg-accent'
        )}
      />

      <Panel className="min-w-0 bg-canvas">{children}</Panel>
    </PanelGroup>
  )
}
