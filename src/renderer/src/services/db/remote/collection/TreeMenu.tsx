import { useState } from 'react'
import { ChevronRight, FolderInput, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useOutsideClose } from '@renderer/lib/useOutsideClose'
import { type MoveTarget } from './tree'

/**
 * 트리(저장쿼리·컬렉션) 공용 우클릭 컨텍스트 메뉴 — 이름 변경 / 이동▶(서브메뉴) / 삭제.
 * "이동"은 클릭하면 오른쪽으로 펼쳐지는 별도 서브메뉴(flyout)로 대상 폴더를 고른다.
 * 대상 목록(targets)은 호출부에서 moveTargets() 로 계산해 넘긴다(자기·자손 폴더 제외됨).
 */
export function TreeContextMenu({ x, y, targets, onRename, onMove, onDelete, onClose }: {
  x: number
  y: number
  targets: MoveTarget[]
  onRename: () => void
  onMove: (parentId: string | null) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [moveOpen, setMoveOpen] = useState(false)
  // 바깥 클릭·Esc·스크롤로 닫는다(다른 화면을 눌러도 안 닫히던 문제 해결).
  const ref = useOutsideClose<HTMLDivElement>(true, onClose)
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel'
  return (
    <div ref={ref} className="fixed z-50 w-48 rounded-md border border-line bg-canvas py-1 text-[12px] shadow-lg" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={item} onClick={() => { onRename(); onClose() }}><Pencil className="size-3.5 text-muted" /> 이름 변경</button>
      <div className="relative">
        <button type="button" className={cn(item, 'justify-between')} onClick={() => setMoveOpen((o) => !o)}>
          <span className="flex items-center gap-2"><FolderInput className="size-3.5 text-muted" /> 이동</span>
          <ChevronRight className={cn('size-3.5 text-muted transition-transform', moveOpen && 'rotate-90')} />
        </button>
        {moveOpen && (
          <div className="absolute left-full top-0 -ml-1 max-h-72 w-52 overflow-auto rounded-md border border-line bg-canvas py-1 shadow-lg">
            {targets.map((t) => (
              <button
                key={t.id ?? '__root'}
                type="button"
                className={cn(item, 'truncate', t.id === null && 'text-muted')}
                style={{ paddingLeft: t.depth * 10 + 12 }}
                onClick={() => { onMove(t.id); onClose() }}
                title={t.label}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className={cn(item, 'border-t border-line text-destructive')} onClick={() => { onDelete(); onClose() }}><Trash2 className="size-3.5" /> 삭제</button>
    </div>
  )
}
