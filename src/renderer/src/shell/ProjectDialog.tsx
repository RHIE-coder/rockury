import { useState } from 'react'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/ui/dialog'
import { oneProject } from './projectScope'
import { useProjectStore } from './projectStore'

/**
 * 새 프로젝트 만들기.
 *
 * 키 규칙을 화면에서 미리 판정하지 않는다 — 규칙의 정본은 저장소 한 곳이고(`store/projects.ts`),
 * 화면에 한 벌 더 적으면 둘이 어긋날 때 사용자가 통과한 값이 저장에서 막히는 일이 생긴다.
 * 대신 저장소가 사람이 읽을 수 있는 문구로 던지고, 여기서 그대로 보인다.
 */
export function ProjectDialog({ onClose }: { onClose: () => void }) {
  const create = useProjectStore((s) => s.create)
  const setScope = useProjectStore((s) => s.setScope)

  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = key.trim().length > 0 && name.trim().length > 0 && !busy

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const created = await create({ key: key.trim(), name, description })
      // 방금 만든 것으로 옮겨 간다 — 만들어 놓고 다시 골라야 하면 만든 뜻이 반만 남는다.
      setScope(oneProject(created.id))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
          <DialogDescription>
            설계·명세·접속을 이 이름으로 묶어 한 번에 좁혀 봅니다.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">이름</span>
            <Input
              autoFocus
              data-project-field="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="쿠팡"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">주소 조각</span>
            <Input
              data-project-field="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="coupang"
            />
            <span className="text-[12px] text-muted">
              화면 주소의 첫 조각이에요. 예: coupang.buyer.auth.login
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">설명 (선택)</span>
            <Input
              data-project-field="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
