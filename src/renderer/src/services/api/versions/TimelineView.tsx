import { useState } from 'react'
import { AlertTriangle, Lock, Milestone, Plus, Radar } from 'lucide-react'
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
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { breakingSummary } from '@shared/api/breaking'
import { useApiStore } from '../store'
import { cutImpact, suggestNextNumber, useVersionsStore, useVersionsSync } from './store'
import type { VersionRecord } from '../../../../../preload/services/api'

/**
 * Versions › Timeline — `docs/spec/api-studio.md` § versions.timeline.
 *
 * 컷은 **사람만** 한다(MCP 에 컷 도구가 없다). 그리고 깨지는 변경이 있으면 승인 게이트를
 * 지난다 — 무엇이 왜 깨지는지 항목별로 보이고, 안 보고 지나칠 수 없게 한다.
 */

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function VersionRow({ v, latest }: { v: VersionRecord; latest: boolean }) {
  return (
    <div
      data-api-version={v.number}
      className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-accent-2-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-accent-2">
        {v.locked && <Lock className="size-3" />}
        {v.number}
      </span>
      {latest && (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent">최신</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
        {v.note || <span className="text-muted/60">메모 없음</span>}
      </span>
      {v.locked && (
        <span
          data-api-version-locked
          title="이 버전을 기준으로 남은 관측이 있어 잠겼습니다 — 지나간 관측의 기준이 흔들리면 안 됩니다."
          className="flex shrink-0 items-center gap-1 text-[11px] text-muted"
        >
          <Radar className="size-3.5" />
          관측 {v.runCount}건
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-muted">
        요청 {v.snapshot.requests.length}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted">{fmt(v.createdAt)}</span>
    </div>
  )
}

function CutDialog() {
  const open = useVersionsStore((s) => s.cutOpen)
  const close = useVersionsStore((s) => s.closeCut)
  const versions = useVersionsStore((s) => s.versions)
  const cut = useVersionsStore((s) => s.cut)
  const spec = useApiStore((s) => s.active)

  const [number, setNumber] = useState('')
  const [note, setNote] = useState('')
  const [approved, setApproved] = useState(false)

  const impact = cutImpact(versions, spec)
  const breaking = impact?.breaking ?? []
  const needsApproval = breaking.length > 0
  const suggested = suggestNextNumber(versions)
  const value = number || suggested

  const dismiss = (): void => {
    setNumber('')
    setNote('')
    setApproved(false)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>버전 확정</DialogTitle>
          <DialogDescription>
            지금 Draft 를 불변 스냅샷으로 굳힙니다. 확정한 뒤 Draft 를 고쳐도 이 스냅샷은 안 바뀝니다.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            번호
            <Input
              autoFocus
              value={value}
              data-api-cut-number
              className="h-8 font-mono text-[13px] font-normal"
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-fg">
            메모 <span className="font-normal text-muted">(선택)</span>
            <Input
              value={note}
              placeholder="이 버전에서 무엇이 달라졌는지"
              className="h-8 text-[13px] font-normal"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {/* 깨지는 변경 승인 게이트 — 자동 통과 없음(spec versions.diff AC-6). */}
          {impact && (
            <div
              data-api-cut-impact={breaking.length}
              className={cn(
                'flex flex-col gap-1.5 rounded-md px-3 py-2 text-[11.5px]',
                needsApproval ? 'bg-danger-soft text-danger' : 'bg-panel text-muted'
              )}
            >
              <span className="font-semibold">
                {versions[0]?.number} 대비 — {breakingSummary(impact)}
              </span>
              {needsApproval ? (
                <>
                  <ul className="flex flex-col gap-0.5">
                    {breaking.map((c, i) => (
                      <li key={i} data-api-breaking-item>
                        · <span className="font-mono">{c.path}</span> — {c.detail}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-0.5 flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={approved}
                      data-api-cut-approve
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    위 변경이 기존 호출자를 깨뜨린다는 것을 알고 확정합니다
                  </label>
                </>
              ) : (
                <span>안전한 변경만 있습니다({impact.changes.length}건).</span>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-3">
          <Button type="button" variant="ghost" onClick={dismiss}>
            취소
          </Button>
          <Button
            disabled={!spec || !value.trim() || (needsApproval && !approved)}
            data-api-cut-submit
            onClick={() => spec && void cut(spec.id, value.trim(), note).then((ok) => ok && dismiss())}
          >
            확정하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TimelineView() {
  useVersionsSync()
  const spec = useApiStore((s) => s.active)
  const versions = useVersionsStore((s) => s.versions)
  const openCut = useVersionsStore((s) => s.openCut)
  const error = useVersionsStore((s) => s.error)
  const clearError = useVersionsStore((s) => s.clearError)

  if (!spec) {
    return (
      <PlaceholderView
        icon={Milestone}
        title="명세를 먼저 고르세요"
        subtitle="버전은 명세 전체의 스냅샷입니다 — 상단 컨텍스트 바에서 명세를 고르세요."
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div data-api-error className="flex items-start gap-2 border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-[2px] size-3.5 shrink-0" />
          <span className="flex-1 whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={clearError}>
            닫기
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Milestone className="size-4 text-muted" />
        <span className="text-[14px] font-semibold text-fg">버전</span>
        <span className="text-[11.5px] text-muted">— 명세 전체의 불변 스냅샷</span>
        <span className="flex-1" />
        <Button size="sm" className="h-7 text-[12px]" data-api-open-cut onClick={openCut}>
          <Plus className="size-3.5" /> 버전 확정
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {versions.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted" data-api-empty="no-version">
            아직 확정한 버전이 없어요. 지금은 Draft 만 있습니다 — 실행 기록도 Draft 기준으로 남습니다.
          </p>
        ) : (
          versions.map((v, i) => <VersionRow key={v.number} v={v} latest={i === 0} />)
        )}
      </div>

      <CutDialog />
    </div>
  )
}
