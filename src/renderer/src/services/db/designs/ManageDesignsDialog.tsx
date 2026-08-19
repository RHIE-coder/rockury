import { useState } from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { dialectInfo } from '../dialects'
import { DialectMark } from '../DialectMark'
import { useDefinitionStore } from '../workspaces/definition/store'
import { useDesignsStore, useScopedDesigns, type DesignDef } from './store'

/** 한 설계 행 — 이름·설명 인라인 편집(blur 커밋) + 삭제(2단 확인). 벤더는 읽기 전용. */
function DesignRow({ design }: { design: DesignDef }) {
  const updateDesign = useDesignsStore((s) => s.updateDesign)
  const removeDesign = useDesignsStore((s) => s.removeDesign)
  const tableCount = useDefinitionStore((s) => s.tables.filter((t) => t.designId === design.id).length)
  const [confirming, setConfirming] = useState(false)
  const info = dialectInfo(design.dialect)

  const commit = (patch: Partial<{ name: string; description: string }>): void => {
    const name = (patch.name ?? design.name).trim()
    const description = (patch.description ?? design.description).trim()
    if (name === design.name && description === design.description) return
    if (!name) return
    void updateDesign(design.id, { name, description })
  }

  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
      <span
        title="벤더는 고정 속성 — 변경하려면 포팅으로 새 설계를 만드세요"
        className="mt-1 flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1 text-[11px] font-medium text-muted"
      >
        <DialectMark dialect={design.dialect} />
        {info.label}
        <Lock className="size-3 opacity-60" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Input
          defaultValue={design.name}
          onBlur={(e) => commit({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-7 font-mono text-[13px]"
          aria-label="설계 이름"
        />
        <Input
          defaultValue={design.description}
          onBlur={(e) => commit({ description: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="설명 (선택)"
          className="h-7 text-[12px]"
          aria-label="설계 설명"
        />
      </div>

      {confirming ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-danger">
            테이블 {tableCount}개도 함께 삭제
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setConfirming(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => void removeDesign(design.id)}
            >
              삭제
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7 shrink-0 text-muted hover:text-danger')}
          aria-label={`${design.name} 삭제`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  )
}

/** 설계 관리 모달 — 목록에서 이름/설명 수정 · 삭제. Design 드롭다운의 "설계 관리…"로 연다. */
export function ManageDesignsDialog() {
  const open = useDesignsStore((s) => s.manageOpen)
  const closeManage = useDesignsStore((s) => s.closeManage)
  const openCreate = useDesignsStore((s) => s.openCreate)
  // 지금 프로젝트 범위의 설계만 — 셀렉터에 안 뜨는 것이 여기 보이면 목록이 두 벌로 보인다.
  const designs = useScopedDesigns()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeManage()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>설계 관리</DialogTitle>
          <DialogDescription>
            이름과 설명을 수정하거나 설계를 삭제합니다. 벤더는 고정 속성이라 바꿀 수 없어요.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 max-h-[52vh] overflow-auto">
          {designs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted">아직 설계가 없어요</div>
          ) : (
            designs.map((d) => <DesignRow key={d.id} design={d} />)
          )}
        </div>

        <div className="mt-3 flex justify-between">
          <Button
            variant="soft"
            size="sm"
            onClick={() => {
              closeManage()
              openCreate()
            }}
          >
            <Plus />새 설계
          </Button>
          <Button size="sm" onClick={closeManage}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
