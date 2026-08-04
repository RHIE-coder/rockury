import { FolderKanban, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { WorkspacePanels } from '@renderer/shell/WorkspacePanels'
import { Button } from '@renderer/ui/button'
import { HierarchyTree } from './HierarchyTree'
import { Inspector } from './Inspector'
import { useActiveProject, useSpecStore } from '../store'

/**
 * Screens 모듈의 공통 셸 — `[위계 | 가운데 | 속성]`.
 *
 * Spec 과 Canvas 는 **가운데만 다르다**(구조 트리 ↔ 미리보기). 뷰를 바꿔도 위계와 속성이
 * 그대로 남아야 "같은 것을 다른 방식으로 본다"가 성립한다 — 셸을 각자 두면 곧 미묘하게 갈린다.
 * Review 는 오른쪽도 바꾼다(속성 → 의견 목록) — 거기선 고르는 목적이 "무엇을 고칠까"라서.
 */
export function ScreensShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const project = useActiveProject()
  const openDialog = useSpecStore((s) => s.openDialog)
  const error = useSpecStore((s) => s.error)
  const clearError = useSpecStore((s) => s.clearError)
  const dialogOpen = useSpecStore((s) => s.dialog !== null)

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
          <FolderKanban size={24} strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold">프로젝트를 고르세요</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted">
          화면 설계는 프로젝트 안에 담깁니다. 위쪽 <span className="font-medium">Project</span> 에서
          고르거나 새로 만드세요.
        </p>
        <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
          <Plus size={14} /> 새 프로젝트
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 오류는 저장소가 거절한 이유를 그대로 보인다 — 규칙(주소 유일성 등)의 최종 판정자가 저장소다. */}
      {error && !dialogOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[13px] text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={clearError} title="닫기">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <WorkspacePanels
          sidebar={<HierarchyTree />}
          collapsible
          sidebarTitle="위계"
          autoSaveId="uiux-screens"
          sidebarActions={
            <button
              className="rounded p-1 text-muted hover:bg-panel hover:text-fg"
              title="앱 추가"
              onClick={() => openDialog({ level: 'application', parentId: project.id })}
            >
              <Plus size={14} />
            </button>
          }
        >
          <div className="flex h-full">
            <div className="min-w-0 flex-1">{children}</div>
            <div className="w-[300px] shrink-0 border-l border-line bg-panel">
              {aside ?? <Inspector />}
            </div>
          </div>
        </WorkspacePanels>
      </div>
    </div>
  )
}
