import { useMemo, useState } from 'react'
import { GitCommitHorizontal, Layers, Sprout } from 'lucide-react'
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
import { cn } from '@renderer/lib/utils'
import { bumpVer, type Bump } from './semver'
import { useVersionsStore, type VersionSnapshot } from './store'

const BUMPS: { type: Bump; label: string; hint: string }[] = [
  { type: 'patch', label: 'Patch', hint: '작은 수정' },
  { type: 'minor', label: 'Minor', hint: '기능 추가' },
  { type: 'major', label: 'Major', hint: '큰 변경' }
]

/**
 * 버전 컷 모달 — 현재 설계의 작업 스키마를 불변 스냅샷으로 찍는다.
 * bump 종류로 번호를 산정(단조 증가 보장), 메모를 남긴다.
 */
export function CutVersionDialog({
  open,
  onClose,
  designId,
  latest,
  tableCount,
  seedRowCount = 0,
  snapshot
}: {
  open: boolean
  onClose: () => void
  designId: string
  latest: string | null
  tableCount: number
  /** 이 스냅샷에 함께 담기는 시드 행 수(0이면 표시하지 않는다). */
  seedRowCount?: number
  snapshot: VersionSnapshot
}) {
  const cut = useVersionsStore((s) => s.cut)
  const base = latest ?? 'v0.0.0'
  const [type, setType] = useState<Bump>(latest ? 'patch' : 'minor')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const number = useMemo(() => bumpVer(base, type), [base, type])

  const dismiss = (): void => {
    setType(latest ? 'patch' : 'minor')
    setNote('')
    onClose()
  }

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      await cut({ designId, number, note: note.trim(), snapshot })
      dismiss()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>버전 컷</DialogTitle>
          <DialogDescription>
            지금 설계 상태를 불변 스냅샷으로 고정합니다. 이후 편집은 다시 draft 로 쌓여요.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex items-center justify-between rounded-lg bg-panel px-3 py-2 text-[12px]">
            <span className="text-muted">
              기준 <span className="font-mono text-fg">{latest ?? '없음(첫 컷)'}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              <Layers className="size-3.5" />
              테이블 {tableCount}개
              {/* 시드도 이 스냅샷에 담긴다는 것을 컷 직전에 보인다(시드 0이면 표시하지 않음). */}
              {seedRowCount > 0 && (
                <>
                  <Sprout className="ml-1 size-3.5" />
                  시드 {seedRowCount}행
                </>
              )}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-fg">증가 유형</span>
            <div className="grid grid-cols-3 gap-2">
              {BUMPS.map((b) => {
                const selected = type === b.type
                return (
                  <button
                    key={b.type}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setType(b.type)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel'
                    )}
                  >
                    <span className="text-[12px] font-semibold text-fg">{b.label}</span>
                    <span className="font-mono text-[11px] text-accent">{bumpVer(base, b.type)}</span>
                    <span className="text-[10.5px] text-muted">{b.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            메모 <span className="font-normal text-muted">(선택)</span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="이 버전의 변경 요약"
              className="h-8 text-[13px] font-normal"
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <GitCommitHorizontal />
              <span className="font-mono">{number}</span> 컷
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
