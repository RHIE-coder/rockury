import { useState } from 'react'
import { GitCommitHorizontal, Layers, Lock, Milestone, RotateCcw, Sprout, Trash2 } from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Checkbox } from '@renderer/ui/checkbox'
import { useActiveDesign } from '../designs/store'
import { useDesignTables } from '../workspaces/definition/store'
import { useSeedLensView } from '../workspaces/seed/store'
import { CutVersionDialog } from './CutVersionDialog'
import { comparePair, togglePick } from './compareSelection'
import { DialectMark } from '../DialectMark'
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
  const updateNote = useVersionsStore((s) => s.updateNote)
  const openRestore = useRestoreStore((s) => s.openRestore)
  const [confirming, setConfirming] = useState(false)
  // 메모는 눌러야 입력칸이 된다 — 늘 입력칸이면 목록이 폼처럼 보여 읽을 때 시끄럽다.
  const [editingNote, setEditingNote] = useState(false)

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
      {/*
        메모는 컷한 **뒤에** 적고 싶어지는 것이라 여기서 바로 고친다(2026-08-05 사용자 요청 —
        "블록체인도 아니고"). 스냅샷·번호는 그대로 불변이다: 스냅샷은 그때의 증거고, 번호는
        id 의 일부라 바꾸면 그 번호를 가리키던 것들이 통째로 뜬다.
      */}
      {editingNote ? (
        <input
          autoFocus
          data-version-note-input={v.number}
          defaultValue={v.note}
          placeholder="이 버전에 담긴 것"
          onBlur={(e) => {
            setEditingNote(false)
            if (e.target.value.trim() !== v.note) void updateNote(designId, v.id, e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            // Esc 는 되돌린다 — 실수로 지웠을 때 빠져나갈 길이 있어야 한다.
            if (e.key === 'Escape') {
              e.currentTarget.value = v.note
              e.currentTarget.blur()
            }
          }}
          className="min-w-0 flex-1 rounded border border-accent/50 bg-canvas px-1.5 py-0.5 text-[13px] text-fg outline-none"
        />
      ) : (
        <button
          type="button"
          data-version-note={v.number}
          onClick={() => setEditingNote(true)}
          title="눌러서 메모 고치기"
          className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-[13px] text-fg hover:bg-panel-strong"
        >
          {v.note || <span className="text-muted/60">메모 없음</span>}
        </button>
      )}
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
  const seedLens = useSeedLensView()
  // 기록이 없는 버전을 보며 컷하면 "시드 0개"를 지어내지 않는다 — 모름은 모름으로 물려준다.
  const seeds = seedLens.source === 'unrecorded' ? undefined : seedLens.sets
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
                <DialectMark dialect={design.dialect} />
                {design.name}
              </span>
            </div>
            {/*
              "컷된 버전은 편집 불가"는 이제 틀린 말이다 — 메모는 고칠 수 있다(2026-08-05).
              그리고 **두 개를 고르면 비교가 열린다**는 사실을 여기서 말한다: 그전엔 하나를
              골랐을 때만 안내가 떠서, 아무것도 안 고른 사람 눈엔 비교 기능이 없는 것으로 보였다
              (사용자 제보 — "버전별로 차이 보여주는 화면 있던걸로 기억하는데").
            */}
            <p className="mt-0.5 text-[12px] text-muted">
              불변 스냅샷 · 메모만 수정 · 두 버전을 고르면 비교
            </p>
          </div>
          <Button size="sm" className="ml-auto" onClick={() => setCutOpen(true)}>
            <GitCommitHorizontal />
            버전 확정
          </Button>
        </div>

        <div className="overflow-hidden rounded-[10px] border border-line">
          {versions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <Milestone className="size-6 text-muted/60" />
              <div className="text-[13px] font-semibold text-fg">아직 확정한 버전이 없어요</div>
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
          seedRowCount={(seeds ?? []).reduce((n, s) => n + s.rows.length, 0)}
          // 시드도 버전에 동봉한다 — 시드는 서비스 정책의 바탕이라 Diff 대상(spec db-design.seed.version-diff).
          snapshot={{ tables, seeds }}
        />
      </div>
    </div>
  )
}
