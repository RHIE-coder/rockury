import { useState } from 'react'
import { GitCommitHorizontal, Layers, Lock, Milestone, RotateCcw, Sprout, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Checkbox } from '@renderer/ui/checkbox'
import { useActiveDesign } from '../designs/store'
import { dialectInfo } from '../dialects'
import { useDesignTables } from '../workspaces/definition/store'
import { useDesignSeedSets } from '../workspaces/seed/store'
import { CutVersionDialog } from './CutVersionDialog'
import { comparePair, togglePick } from './compareSelection'
import { useRestoreStore } from './restoreStore'
import { latestVer } from './semver'
import { VersionDiffPanel } from './VersionDiffPanel'
import { useDesignVersions, useVersionsStore, type VersionDef } from './store'

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** 버전 한 줄 — 비교 고르기·번호·메모·테이블수·시각 + 삭제(잘못 컷된 버전 회수). 잠긴 버전은 삭제 불가. */
function VersionRow({
  v,
  designId,
  latest,
  picked,
  onPick
}: {
  v: VersionDef
  designId: string
  latest: boolean
  picked: boolean
  onPick: () => void
}) {
  const remove = useVersionsStore((s) => s.remove)
  const openRestore = useRestoreStore((s) => s.openRestore)
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      data-version-number={v.number}
      data-picked={picked || undefined}
      className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 data-[picked]:bg-accent-soft/40"
    >
      <Checkbox
        data-version-pick={v.number}
        checked={picked}
        onCheckedChange={onPick}
        // 라벨을 안 붙인다 — 두 개를 고르면 아래에 비교가 열려서 뜻이 그 자리에서 드러난다.
        title="비교할 버전으로 고르기"
      />
      <span className="flex items-center gap-1.5 rounded-full bg-accent-2-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-accent-2">
        {v.locked && <Lock className="size-3" />}
        {v.number}
      </span>
      {latest && (
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
      {/* 시드 행 수 — 시드가 담긴 버전만 보인다(옛 스냅샷엔 시드가 없다). */}
      {!!v.snapshot.seeds?.length && (
        <span
          data-version-seed-rows
          className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted"
          title="시드 행 수"
        >
          <Sprout className="size-3.5" />
          {v.snapshot.seeds.reduce((n, s) => n + s.rows.length, 0)}
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums text-muted">{fmt(v.createdAt)}</span>
      {/* 되돌리기 — 잠긴 버전도 **읽기만** 하므로 막지 않는다(지우는 것과 다르다). */}
      <Button
        variant="ghost"
        size="icon"
        data-restore-version={v.number}
        className="size-7 shrink-0 text-muted opacity-0 transition-opacity hover:text-accent-2 group-hover:opacity-100"
        title={`Draft 를 ${v.number} 로 되돌리기`}
        onClick={() => openRestore(designId, v)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
      {!v.locked &&
        (confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setConfirming(false)}>
              취소
            </Button>
            <Button variant="destructive" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void remove(designId, v.id)}>
              삭제
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            title="버전 삭제"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ))}
    </div>
  )
}

/**
 * Design › Versions — 설계의 버전 컷 목록 + 새 컷 + **고른 두 버전의 비교**.
 *
 * 예전엔 `Versions` 가 모듈이었고 그 안이 `Timeline`·`Version Diff` 두 화면이었다. 2026-08-03
 * 사용자 결정으로 Design 안 뷰 하나로 접혔다 — 비교는 목록에서 두 줄을 고르면 아래에 열린다.
 */
export function VersionsView() {
  const design = useActiveDesign()
  const versions = useDesignVersions(design?.id ?? null)
  const tables = useDesignTables()
  const seeds = useDesignSeedSets()
  const [cutOpen, setCutOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  if (!design) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-muted">상단에서 설계를 먼저 선택하세요.</p>
      </div>
    )
  }

  const latest = latestVer(versions.map((v) => v.number))
  const info = dialectInfo(design.dialect)
  const pair = comparePair(versions, picked)

  return (
    // 셸의 워크스페이스 칸은 overflow-hidden 이라 스크롤 상자는 각 뷰가 세운다(AppShell).
    <div className="h-full overflow-auto">
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
              <VersionRow
                key={v.id}
                v={v}
                designId={design.id}
                latest={i === 0}
                picked={picked.includes(v.id)}
                onPick={() => setPicked((p) => togglePick(p, v.id))}
              />
            ))
          )}
        </div>

        {/* 하나만 골랐을 때만 나오는 안내 — 늘 띄우면 안 쓰는 사람에게 줄 하나가 계속 남는다. */}
        {picked.length === 1 && (
          <p className="mt-3 text-[12px] text-muted">비교할 버전 하나 더</p>
        )}
        {pair && <VersionDiffPanel base={pair.base} target={pair.target} />}

        <CutVersionDialog
          open={cutOpen}
          onClose={() => setCutOpen(false)}
          designId={design.id}
          latest={latest}
          tableCount={tables.length}
          seedRowCount={seeds.reduce((n, s) => n + s.rows.length, 0)}
          // 시드도 버전에 동봉한다 — 시드는 서비스 정책의 바탕이라 Diff 대상(spec db-design.seed.version-diff).
          snapshot={{ tables, seeds }}
        />
      </div>
    </div>
  )
}
