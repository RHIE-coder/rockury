import { useState } from 'react'
import { GitCommitHorizontal, Layers, Lock, Milestone } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { useActiveDesign } from '../designs/store'
import { dialectInfo } from '../dialects'
import { useDesignTables } from '../workspaces/definition/store'
import { CutVersionDialog } from './CutVersionDialog'
import { latestVer } from './semver'
import { useDesignVersions } from './store'

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Versions › Timeline — 설계의 버전 컷 목록 + 새 컷. (diff 는 Version Diff 뷰에서) */
export function TimelineView() {
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  const tables = useDesignTables()
  const [cutOpen, setCutOpen] = useState(false)

  if (!design) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-muted">상단에서 설계를 먼저 선택하세요.</p>
      </div>
    )
  }

  const latest = latestVer(versions.map((v) => v.number))
  const info = dialectInfo(design.dialect)

  return (
    <div className="mx-auto max-w-[880px] px-5 py-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[16px] font-bold tracking-tight text-fg">
            <Milestone className="size-4 text-muted" />
            버전 타임라인
            <span className="flex items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-medium text-fg">
              <span className="size-1.5 rounded-full" style={{ background: info.dot }} />
              {design.name}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            설계의 불변 스냅샷 · 단조 증가 · 컷된 버전은 편집 불가
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setCutOpen(true)}>
          <GitCommitHorizontal />
          버전 컷
        </Button>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <Milestone className="size-6 text-muted/60" />
            <div className="text-[13px] font-semibold text-fg">아직 컷된 버전이 없어요</div>
            <p className="max-w-72 text-[12px] text-muted">
              지금 스키마를 첫 버전으로 고정해 계보를 시작하세요.
            </p>
          </div>
        ) : (
          versions.map((v, i) => (
            <div
              key={v.id}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="flex items-center gap-1.5 rounded-full bg-accent-2-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-accent-2">
                {v.locked && <Lock className="size-3" />}
                {v.number}
              </span>
              {i === 0 && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent">
                  최신
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                {v.note || <span className="text-muted/60">메모 없음</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted">
                <Layers className="size-3.5" />
                {v.snapshot.tables.length}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">{fmt(v.createdAt)}</span>
            </div>
          ))
        )}
      </div>

      <CutVersionDialog
        open={cutOpen}
        onClose={() => setCutOpen(false)}
        designId={design.id}
        latest={latest}
        tableCount={tables.length}
        snapshot={{ tables }}
      />
    </div>
  )
}
