import { useState } from 'react'
import { Info } from 'lucide-react'
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
import { useNav } from '@renderer/nav/useNav'
import { cn } from '@renderer/lib/utils'
import { INTERFACE_META, SHAPE_LABEL, type InterfaceKind } from '@shared/api/types'
import { useApiStore } from '../store'


/**
 * 새 명세 모달 — 이름 · 설명 · 인터페이스 종류.
 * 종류는 명세의 고정 속성(생성 시 1회 결정)이라 이후 바꿀 수 없다 — 편집 표면이 종류에 따라
 * 통째로 달라지기 때문이다(spec §2). 바꾸려면 새 명세를 만든다.
 */
export function CreateSpecDialog() {
  const open = useApiStore((s) => s.createOpen)
  const closeCreate = useApiStore((s) => s.closeCreate)
  const addSpec = useApiStore((s) => s.addSpec)
  const setContextValue = useNav((s) => s.setContextValue)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<InterfaceKind | null>(null)

  const canSubmit = name.trim().length > 0 && kind != null

  const dismiss = (): void => {
    setName('')
    setDescription('')
    setKind(null)
    closeCreate()
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || !kind) return
    const id = await addSpec({ name, description: description.trim(), kind })
    setContextValue('spec', id)
    dismiss()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 API 명세</DialogTitle>
          <DialogDescription>
            이름과 인터페이스 종류를 정하면 명세가 만들어져요. 요청·버전은 이 명세 아래에서
            관리됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            이름
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: billing-api"
              className="h-8 font-mono text-[13px] font-normal"
              data-api-spec-name
            />
          </label>

          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            설명 <span className="font-normal text-muted">(선택)</span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 명세가 다루는 범위"
              className="h-8 text-[13px] font-normal"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-fg">인터페이스 종류</span>
            <div className="grid grid-cols-2 gap-2">
              {INTERFACE_META.map((m) => {
                const selected = kind === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={selected}
                    data-api-kind={m.id}
                    onClick={() => setKind(m.id)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel'
                    )}
                  >
                    <span className="text-[13px] font-semibold text-fg">{m.label}</span>
                    <span className="text-[11px] leading-snug text-muted">
                      {m.shapes.map((s) => SHAPE_LABEL[s]).join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-0.5 flex items-start gap-1.5 rounded-md bg-panel px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
              <Info className="mt-[3px] size-3.5 shrink-0" />
              <span>
                종류는 명세의 고정 속성이라 생성 후 바꿀 수 없어요. 편집 화면에 나오는 칸이
                종류마다 다르기 때문입니다 — 다른 종류가 필요하면 명세를 새로 만듭니다.
              </span>
            </p>
          </div>

          <DialogFooter className="mt-1">
            <Button type="button" variant="ghost" onClick={dismiss}>
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit} data-api-spec-submit>
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
