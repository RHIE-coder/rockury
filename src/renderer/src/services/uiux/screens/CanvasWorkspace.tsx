import { Frame, MonitorSmartphone } from 'lucide-react'
import { useContextValue } from '@renderer/nav/useNav'
import { isSamePlace } from '../preview/dnd'
import { VIEWPORT_LABEL, VIEWPORT_WIDTH } from '../preview/tokens'
import { moveComponent } from '../tree'
import { useSpecStore, useTree } from '../store'
import type { Viewport } from '../types'
import { Preview } from './Preview'
import { ScreensShell } from './ScreensShell'

/**
 * Screens › Canvas — 고른 화면을 **실제 화면으로 보고 그 위에서 고친다.**
 * 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.screens.canvas`.
 *
 * 끌어 옮겨도 저장되는 것은 좌표가 아니라 **순서**다(§6). Spec 뷰의 위·아래 버튼과 **같은 함수**를
 * 부른다 — 편집 규칙이 화면마다 갈리면 한쪽에서만 되는 조작이 생긴다.
 */
export function CanvasWorkspace() {
  return (
    <ScreensShell>
      <CanvasPane />
    </ScreensShell>
  )
}

function CanvasPane() {
  const content = useSpecStore((s) => s.content)
  const surfaceId = useSpecStore((s) => s.selectedSurfaceId)
  const selectedNodeId = useSpecStore((s) => s.selectedNodeId)
  const selectNode = useSpecStore((s) => s.selectNode)
  const editContent = useSpecStore((s) => s.editContent)
  const tree = useTree()
  const viewport = (useContextValue('viewport') ?? 'pc') as Viewport

  const surface = tree.surfaces.find((s) => s.id === surfaceId)

  if (!surface || !content) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Frame size={22} className="text-muted" />
        <p className="text-[13px] text-muted">왼쪽에서 화면을 고르면 여기 그려져요.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="truncate text-[12px] font-semibold tracking-wide text-muted">
          {surface.name}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <MonitorSmartphone size={13} />
          {VIEWPORT_LABEL[viewport] ?? viewport} · {VIEWPORT_WIDTH[viewport] ?? VIEWPORT_WIDTH.pc}px
        </span>
      </div>
      <div className="min-h-0 flex-1" data-uiux-preview={surface.id}>
        <Preview
          content={content}
          viewport={viewport}
          selectedId={selectedNodeId}
          onSelect={selectNode}
          onMove={(id, target) => {
            // 제자리에 놓으면 저장하지 않는다 — 안 그러면 집었다 놓기만 해도 이력이 한 번 돈다.
            if (isSamePlace(content, id, target)) return
            void editContent((c) => moveComponent(c, id, target.sectionId, target.index))
          }}
        />
      </div>
    </div>
  )
}
