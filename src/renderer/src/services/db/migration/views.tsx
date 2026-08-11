import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  FileDiff,
  Layers,
  Link2,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ScrollText,
  Server,
  Undo2,
  XCircle
} from 'lucide-react'
import { Button } from '@renderer/ui/button'
import { Badge } from '@renderer/ui/badge'
import { Checkbox } from '@renderer/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/ui/select'
import { cn } from '@renderer/lib/utils'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { useNav } from '@renderer/nav/useNav'
import { useActiveDesign, type DesignDef } from '../designs/store'
import { useActiveConnection, type ConnectionDef } from '../connections/store'
import { useDesignVersions } from '../versions/store'
import type { SchemaDiff } from '../versions/diff'
import { isEmptyDiff } from '../versions/diff'
import { isEmptySeedDiff, type SeedDiff } from '../versions/seedDiff'
import { useMigrationStore } from './store'
import { SchemaDiffExplorer } from './SchemaDiffExplorer'
import { diagnosisState, hasDrift as diffHasDrift } from './diagnose'
import { groupDrift } from './driftSummary'
import type { MigrationStatement } from './ddlDiff'
import { groupStatements } from './planGroups'
import { useImportStore } from './importStore'

interface Ctx {
  design: DesignDef
  connection: ConnectionDef
}

/**
 * 공통 가드 — Migration 은 실제(Connection)를 설계 버전과 대조하므로 **둘 다** 필요하다.
 * (Remote 는 Connection 만으로 되지만, 마이그레이션은 설계가 있어야 diff 대상이 생긴다.)
 */
function useCtx(): { ctx: Ctx | null; fallback: ReactElement | null } {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  if (!connection)
    return { ctx: null, fallback: <Guard title="연결을 선택하세요" sub="Connection 셀렉터에서 대상 실 DB 를 고르세요." /> }
  if (!design)
    return {
      ctx: null,
      fallback: (
        <Guard title="설계를 선택하세요" sub="마이그레이션은 실제(연결)를 설계 버전과 대조합니다. 상단 Design 셀렉터에서 대상 설계를 고르세요." />
      )
    }
  return { ctx: { design, connection }, fallback: null }
}

function Guard({ title, sub }: { title: string; sub?: string }): ReactElement {
  return <PlaceholderView icon={Radar} depth="depth 3 · Migration" title={title} subtitle={sub} />
}

/** 대조표(SchemaDiffExplorer)와 같은 팔레트를 쓴다 — 화면을 옮길 때 색이 뜻을 바꾸면 안 된다. */
const STATUS_COLOR: Record<string, string> = {
  added: 'text-success',
  removed: 'text-danger',
  modified: 'text-warning'
}

function DiffSummary({ diff }: { diff: SchemaDiff }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {/* 숫자는 DriftScale 한 곳에서만 그린다 — 0 까지 늘어놓던 `+6 / ~18 / -0` 은 여기서 사라졌다. */}
      <DriftScale diff={diff} />
      <div className="flex flex-wrap gap-1.5">
        {diff.tables.map((t) => (
          <span key={t.id} className={cn('rounded-md bg-panel-strong px-2 py-0.5 font-mono text-[11px]', STATUS_COLOR[t.status])}>
            {t.status === 'added' ? '+ ' : t.status === 'removed' ? '- ' : '~ '}
            {t.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * 드리프트 눈금 — 종류마다 한 칸, 칸 안에 `+ − ~` 숫자만.
 *
 * 예전엔 `summarizeDrift` 가 만든 한 줄(아홉 항목)을 그대로 제목 옆에 붙였다. 스물몇 낱말이
 * 줄줄이 흘러 "몇 개가 어떻게" 중 아무것도 안 남았다(2026-08-10 사용자: "저렇게 계속 나열하면
 * 누가 알아. 좀 시인성 좋게"). 숫자를 색으로 갈라 두면 눈이 낱말을 안 읽고도 크기를 잡는다.
 */
function DriftScale({ diff }: { diff: SchemaDiff }): ReactElement | null {
  const groups = groupDrift(diff)
  if (groups.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <span
          key={g.label}
          className="flex items-center gap-2 rounded-md bg-canvas px-2 py-1 text-[12px] ring-1 ring-line"
        >
          <span className="font-medium text-fg">{g.label}</span>
          {g.added > 0 && <b className="font-mono text-success">+{g.added}</b>}
          {g.removed > 0 && <b className="font-mono text-danger">−{g.removed}</b>}
          {g.modified > 0 && <b className="font-mono text-warning">~{g.modified}</b>}
        </span>
      ))}
    </div>
  )
}

function SeedSummary({ diff }: { diff: SeedDiff }): ReactElement | null {
  if (isEmptySeedDiff(diff)) return null
  const s = diff.summary
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-muted">
      <span>시드 세트 <b className="text-success">+{s.setsAdded}</b> / <b className="text-accent-2">~{s.setsModified}</b> / <b className="text-destructive">-{s.setsRemoved}</b></span>
      <span>행 <b className="text-success">+{s.rowsAdded}</b> / <b className="text-accent-2">~{s.rowsModified}</b> / <b className="text-destructive">-{s.rowsRemoved}</b></span>
    </div>
  )
}

function ErrorBar(): ReactElement | null {
  const error = useMigrationStore((s) => s.error)
  const dismiss = useMigrationStore((s) => s.dismissError)
  if (!error) return null
  return (
    <div className="mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
      {error}
      <button type="button" className="ml-2 opacity-70 hover:opacity-100" onClick={dismiss}>✕</button>
    </div>
  )
}

/**
 * 상태 줄 — **이 모듈의 전부가 여기 있다.**
 *
 * `Design v0.2.0 ── 2단계 앞섬 ── Remote v0.1.0`
 *
 * 예전엔 탭마다 자기가 무엇과 무엇을 견주는지 따로 적었다(Drift 는 기준선↔실제, Plan 은
 * 설계↔실제). 그래서 어느 화면에 있느냐에 따라 "무엇과 무엇"이 달라져, 매번 다시 읽어야 했다
 * (2026-08-10 사용자 지적: "화면이 좀 많이 꼬인 것 같다"). 이제 이 한 줄이 모든 탭 위에 서고,
 * 탭은 그 줄에서 갈라지는 일만 한다.
 */
function StatusLine({ ctx }: { ctx: Ctx }): ReactElement {
  const remote = useMigrationStore((s) => s.remoteVersion)
  const target = useMigrationStore((s) => s.targetVersion)
  const diagnosis = useMigrationStore((s) => s.diagnosis)
  const state = diagnosis ? diagnosisState(diagnosis, !!remote) : remote ? 'synced' : 'unmapped'

  /**
   * "샘"은 쓰지 않는다 — drift 를 직역한 말인데 한국어로는 수도꼭지 소리로 읽힌다
   * (2026-08-10 사용자: "DB가 새다니.. 무슨 수도꼭지여?"). 옆의 "설계가 앞섬"과 짝이 맞게
   * **무엇이 어떤 상태인가**로 적는다.
   */
  const relation: Record<string, { label: string; tone: string }> = {
    unmapped: { label: '아직 모름', tone: 'text-muted' },
    drifted: { label: '실제가 다름', tone: 'text-destructive' },
    ahead: { label: '설계가 앞섬', tone: 'text-accent-2' },
    synced: { label: '일치', tone: 'text-success' }
  }
  const r = relation[state]

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel/40 px-5 py-2.5 text-[13px]">
      <span className="flex items-center gap-1.5">
        <Layers className="size-3.5 shrink-0 text-muted" />
        <span className="truncate text-muted">{ctx.design.name}</span>
        <b className="font-mono text-fg">{target || '—'}</b>
      </span>
      <span className="flex items-center gap-1.5 text-muted" aria-hidden>
        ──<span className={cn('font-semibold', r.tone)}>{r.label}</span>──
      </span>
      <span className="flex items-center gap-1.5">
        <Server className="size-3.5 shrink-0 text-muted" />
        <span className="truncate text-muted">{ctx.connection.name}</span>
        <b className="font-mono text-fg">{remote || '—'}</b>
      </span>
    </div>
  )
}

function Header({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
      <h2 className="text-[14px] font-bold text-fg">{title}</h2>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

/**
 * 진단·계획·실행이 공유하는 뼈대 — 상태 줄은 언제나 맨 위다.
 *
 * `footer` 는 **스크롤 밖**에 선다. 계획 화면의 "실행으로" 버튼을 본문 끝에 뒀더니 SQL 84개
 * 아래로 밀려나 찾아 내려가야 했다(2026-08-10 사용자: "지금 숨은 그림 찾기야?"). 다음 걸음은
 * 본문 길이와 무관하게 언제나 보여야 한다.
 */
function Shell({
  title,
  ctx,
  actions,
  footer,
  children
}: {
  title: string
  ctx: Ctx
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <StatusLine ctx={ctx} />
      <Header title={title}>{actions}</Header>
      <ErrorBar />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">{children}</div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-panel/60 px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * 범위 알림 — 기준선을 찍을 때와 지금 읽은 스키마 범위가 다르면 아래 차이는 DB 변경이 아니다.
 * 경우가 둘인 이유는 "달라졌다"와 "모른다"가 다른 사실이기 때문이다(뒤엣것은 단정하지 않는다).
 */
function ScopeNotice(): ReactElement | null {
  const changed = useMigrationStore((s) => s.scopeChanged)
  const base = useMigrationStore((s) => s.baselineScope)
  const now = useMigrationStore((s) => s.actualScope)
  const hasBaseline = useMigrationStore((s) => s.hasBaseline)
  const diagnosis = useMigrationStore((s) => s.diagnosis)
  const drifted = !!diagnosis && diffHasDrift(diagnosis)
  const label = (v: string[]): string => (v.length ? v.join(', ') : '기본 스키마')

  if (changed)
    return (
      <div className="flex items-start gap-2 rounded-md bg-accent-soft/60 px-3 py-2 text-[12px] text-fg ring-1 ring-accent/30">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-2" />
        <span>
          읽은 스키마가 달라졌습니다. 기준선은 <b className="font-mono">{label(base)}</b> 를 봤고,
          지금은 <b className="font-mono">{label(now)}</b> 를 봤습니다. 아래 차이 중 일부는 DB 가
          바뀐 것이 아니라 보는 범위가 달라진 것입니다.
        </span>
      </div>
    )

  if (hasBaseline && drifted && base.length === 0)
    return (
      <div className="flex items-start gap-2 rounded-md bg-panel px-3 py-2 text-[12px] text-muted">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          이 기준선은 어느 스키마를 봤는지 안 남겼습니다. 지금 본 것은{' '}
          <b className="font-mono text-fg">{label(now)}</b> 입니다. 그때 본 것이 이와 달랐다면 아래
          차이 중 일부는 DB 가 바뀐 것이 아닙니다.
        </span>
      </div>
    )

  return null
}

// ═══════════════════════════ 진단 ═══════════════════════════
/**
 * 진단 — 이 모듈의 입구.
 *
 * 상태가 넷뿐이고, 각 상태가 **다음에 할 일 하나**를 내민다:
 *   unmapped → 맵핑(이 연결이 몇 버전인지 못박기)
 *   drifted  → 흡수 / 원복 / 인정
 *   ahead    → 계획 보기
 *   synced   → 할 일 없음
 */
export function DiagnoseView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const selectView = useNav((s) => s.selectView)
  const openImport = useImportStore((s) => s.openImport)
  const cid = ctx?.connection.id
  const did = ctx?.design.id

  useEffect(() => {
    if (cid && did) void useMigrationStore.getState().runDiagnosis(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])

  if (!ctx) return fallback!
  const state = st.diagnosis ? diagnosisState(st.diagnosis, !!st.remoteVersion) : 'unmapped'

  return (
    <Shell
      title="진단"
      ctx={ctx}
      actions={
        <Button size="sm" variant="outline" disabled={st.loading} onClick={() => void st.runDiagnosis(ctx.connection.id, ctx.design.id)}>
          {st.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 다시 검사
        </Button>
      }
    >
      {st.loading && !st.diagnosis ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 실제 DB 를 읽는 중…</div>
      ) : state === 'unmapped' ? (
        <MappingPanel ctx={ctx} />
      ) : (
        <>
          <ScopeNotice />

          {/* ── 실제가 설계와 다른 것. 먼저 처리해야 하는 쪽이라 위에 둔다 ── */}
          {state === 'drifted' && st.diagnosis?.drift && (
            <section className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-destructive">
                <AlertTriangle className="size-4" /> 실 DB 가 설계와 다릅니다
              </div>
              <p className="text-[12px] text-fg">
                누군가 실 DB 를 직접 고쳤습니다. 이대로 반영하면 그 변경이 지워집니다.
              </p>
              <DiffSummary diff={st.diagnosis.drift} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design)}>
                  <DownloadCloud /> 설계로 흡수
                </Button>
                <Button size="sm" variant="outline" onClick={() => selectView('plan')}>
                  <FileDiff /> 설계대로 되돌리기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void st.captureBaseline(ctx.connection.id, ctx.design.id, st.remoteVersion)}>
                  <Camera /> 이대로 두기
                </Button>
              </div>
              <p className="text-[11.5px] text-muted">이대로 두면 이 차이는 기록에만 남습니다(Logs).</p>
            </section>
          )}

          {/* ── 설계가 앞선 것 ── */}
          <section className="flex flex-col gap-3">
            <div className="text-[13px] font-semibold text-fg">설계가 앞선 것</div>
            {!st.diagnosis?.ahead ? (
              <p className="text-[12px] text-muted">
                {st.remoteVersion ? '비교할 타깃 버전 없음' : 'Remote 버전 모름'}
              </p>
            ) : isEmptyDiff(st.diagnosis.ahead.schema) && isEmptySeedDiff(st.diagnosis.ahead.seed) ? (
              <div className="flex items-center gap-2 text-[13px] text-success">
                <CheckCircle2 className="size-4" /> 밀 것 없음. 설계와 실제가 같은 버전입니다
              </div>
            ) : (
              <>
                <DiffSummary diff={st.diagnosis.ahead.schema} />
                <SeedSummary diff={st.diagnosis.ahead.seed} />
                <div>
                  <Button size="sm" onClick={() => selectView('plan')}>
                    <FileDiff /> 계획 보기
                  </Button>
                </div>
              </>
            )}
          </section>

          <BaselineHistory />
        </>
      )}
    </Shell>
  )
}

/**
 * 맵핑 — "이 연결은 어느 설계의 몇 버전인가?"
 *
 * 연결을 처음 물리면 우리는 이 답을 모른다. 그래서 실제를 떠서 설계의 버전들과 대조하고
 * 사람에게 확정을 받는다. 이 관문이 없으면 `Remote —` 인 채로 Migration 을 열게 되고,
 * 그때는 무엇과 무엇을 견주는지 아무도 모른다(2026-08-10 사용자 지적의 뿌리).
 */
function MappingPanel({ ctx }: { ctx: Ctx }): ReactElement {
  const st = useMigrationStore()
  const openImport = useImportStore((s) => s.openImport)
  const versions = useDesignVersions(ctx.design.id)

  useEffect(() => {
    if (!st.identified && !st.loading) void st.identify(ctx.connection.id, ctx.design.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.connection.id, ctx.design.id])

  const best = st.identified?.candidates[0] ?? null

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel/50 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <Link2 className="size-4" /> 이 연결은 아직 맵핑되지 않았습니다
      </div>
      <p className="max-w-2xl text-[12px] leading-relaxed text-muted">
        실 DB 가 <b className="text-fg">{ctx.design.name}</b> 의 어느 버전인지 정해야 무엇과 무엇을
        견줄지가 정해집니다.
      </p>

      {st.loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 버전을 찾는 중…</div>
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[12px] text-muted">이 설계에는 버전이 없습니다.</p>
          <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design)}>
            <DownloadCloud /> 실 DB 를 첫 버전으로 들이기
          </Button>
        </div>
      ) : st.identified?.match ? (
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-[13px] text-success">
            <CheckCircle2 className="size-4" /> 실 DB 가 <b className="font-mono">{st.identified.match}</b> 와 똑같습니다
          </div>
          <Button size="sm" onClick={() => void st.confirmMapping(ctx.connection.id, ctx.design.id, st.identified!.match!)}>
            <Link2 /> {st.identified.match} 으로 못박기
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-[13px] text-accent-2">
            <AlertTriangle className="size-4" /> 똑같은 버전이 없습니다
          </div>
          {best && (
            <>
              <p className="text-[12px] text-muted">
                가장 가까운 것은 <b className="font-mono text-fg">{best.number}</b> 입니다.
              </p>
              <DiffSummary diff={best.diff} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={() => openImport(ctx.connection, ctx.design)}>
              <DownloadCloud /> 새 버전으로 들이기
            </Button>
            {best && (
              <Button size="sm" variant="outline" onClick={() => void st.confirmMapping(ctx.connection.id, ctx.design.id, best.number)}>
                <Link2 /> {best.number} 으로 두고 차이는 드리프트로
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** 목록·머리글이 같은 모양으로 시각을 적게 — 초 단위는 이 화면에서 쓸 데가 없다. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/** 기준선 이력 — 이 짝에 쌓인 스냅샷. */
function BaselineHistory(): ReactElement | null {
  const snapshots = useMigrationStore((s) => s.snapshots)
  if (snapshots.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold text-fg">기준선 이력</div>
      <div className="flex flex-col gap-1.5">
        {snapshots.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 rounded-md border border-line bg-canvas px-3 py-2 text-[12px]">
            <Camera className="size-3.5 shrink-0 text-muted" />
            <span className="shrink-0 text-fg">{stamp(s.createdAt)}</span>
            {/* 버전 없이 찍힌 기준선(반영을 거치지 않은 캡처)이 흔하다 — 빈 자리에 `—` 를 두면 소음만 는다. */}
            {s.version && <span className="shrink-0 font-mono text-muted">{s.version}</span>}
            <span className="min-w-0 flex-1 truncate text-muted">테이블 {s.tableCount}개</span>
            {i === 0 && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">현재 기준</Badge>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════ 가져오기 ═══════════════════════════
/**
 * 되먹임의 문 — 실 DB 를 역설계해 설계의 새 버전으로 들인다.
 * 진단·맵핑이 "만들어야 한다"고 판정했을 때 부르는 조치라, 그쪽에서도 버튼으로 연다.
 */
export function ImportView(): ReactElement {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  const openImport = useImportStore((s) => s.openImport)
  const diagnosis = useMigrationStore((s) => s.diagnosis)

  if (!connection)
    return <Guard title="연결을 선택하세요" sub="설계로 들일 실 DB 를 고르세요." />

  return (
    <div className="flex h-full flex-col">
      {design && <StatusLine ctx={{ design, connection }} />}
      <Header title="가져오기">
        <Button size="sm" onClick={() => openImport(connection, design ?? null)}>
          <DownloadCloud /> {design ? '설계로 가져오기' : '새 설계로 가져오기'}
        </Button>
      </Header>
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!design ? (
          <div className="text-[13px] text-muted">물린 설계 없음. 가져오면 첫 버전과 결속이 함께 세워집니다</div>
        ) : diagnosis?.drift && !isEmptyDiff(diagnosis.drift) ? (
          // 진단이 이미 읽은 결과가 곧 "들일 것"이다 — 여기서 또 읽지 않는다(같은 검사다).
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-2"><AlertTriangle className="size-4" /> 들일 변경</div>
            <DiffSummary diff={diagnosis.drift} />
          </div>
        ) : (
          <div className="text-[13px] text-muted">들일 변경 없음</div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════ 계획 ═══════════════════════════
/**
 * SQL 목록 — **테이블로 묶고, 접힌 채로 시작한다.**
 *
 * 낱개 상자 84개를 펼쳐 놓았을 때 화면 넉 장이 SQL 로만 찼고 그 뒤의 버튼까지 밀려났다
 * (2026-08-10 사용자: "이걸 지금 나보고 보라고?"). SQL 은 **확인하는 자리**라 기본은
 * "어느 테이블에 몇 개가 나가나"까지만 보이고, 문장은 펼쳐 볼 때 나온다.
 */
function StatementGroups({ statements }: { statements: MigrationStatement[] }): ReactElement {
  const groups = groupStatements(statements)
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <StatementGroupRow key={g.table} table={g.table} destructiveCount={g.destructiveCount} statements={g.statements} />
      ))}
    </div>
  )
}

function StatementGroupRow({
  table,
  destructiveCount,
  statements
}: {
  table: string
  destructiveCount: number
  statements: MigrationStatement[]
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-panel/60 px-2 py-1.5 text-left text-[12px] hover:bg-panel-strong/70"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate font-mono text-fg">{table}</span>
        {destructiveCount > 0 && (
          <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">
            지움 {destructiveCount}
          </Badge>
        )}
        <span className="shrink-0 tabular-nums text-muted">{statements.length}개</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line p-2">
          {statements.map((s, i) => (
            <div key={i} className="font-mono text-[11.5px]">
              <div className="mb-0.5 flex gap-1.5">
                <Badge variant={s.destructive ? 'destructive' : 'secondary'} className="px-1 py-0 text-[10px]">
                  {s.kind}
                </Badge>
                {s.note && <span className="text-[11px] text-muted">{s.note}</span>}
              </div>
              <div className="whitespace-pre-wrap text-fg">{s.sql}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * SQL 묶음을 담는 칸 — 스스로 스크롤한다.
 * 안 그러면 테이블 서른 개를 펼쳤을 때 바깥 스크롤이 다시 길어져 접기가 뜻이 없어진다.
 */
function SqlSection({
  title,
  count,
  note,
  children
}: {
  title: string
  count: number
  note?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="text-[12px] font-semibold text-fg">
        {title} <span className="font-normal text-muted">{count}개</span>
      </div>
      {note}
      <div className="max-h-[420px] min-w-0 overflow-y-auto pr-0.5">{children}</div>
    </section>
  )
}

/**
 * 계획의 대조표 — "지금 → 반영 뒤"를 Definition 과 같은 문법으로.
 * SQL 목록은 아래에 그대로 남는다: 이 표는 **판단하는 자리**, SQL 은 **나갈 문을 확인하는 자리**다.
 */
function PlanTables(): ReactElement | null {
  const actual = useMigrationStore((s) => s.actual)
  const target = useMigrationStore((s) => s.planTarget)
  const design = useActiveDesign()
  if (!actual || !target || !design) return null
  return <SchemaDiffExplorer before={actual} after={target} designId={design.id} />
}

export function PlanView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const versions = useDesignVersions(ctx?.design.id ?? null)
  const cid = ctx?.connection.id
  const did = ctx?.design.id
  const designDialect = ctx?.design.dialect
  /**
   * 들어오면 이미 정해진 타깃으로 계획을 만든다 — 진단이 들어오면 검사하는 것과 같은 규율.
   * 셀렉터가 값을 **보여주면서** 계획은 onValueChange 에서만 만들던 시절, 버전이 떠 있는데
   * 본문은 "선택하세요"인 막다른 골목이 있었다(2026-08-10 사용자 지적).
   */
  useEffect(() => {
    if (!cid || !did || !designDialect) return
    void (async () => {
      const bound = await useMigrationStore.getState().resolveBinding(cid, did)
      const store = useMigrationStore.getState()
      const v = store.targetVersion ?? bound.targetVersion
      if (v) await store.loadPlan(cid, did, designDialect, v)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did, designDialect])

  if (!ctx) return fallback!
  const dialect = ctx.design.dialect
  const ready = !st.loading && !!st.plan && st.plan.statements.length > 0

  return (
    <Shell
      title="계획"
      ctx={ctx}
      actions={
        <Select value={st.targetVersion ?? undefined} onValueChange={(v) => void st.loadPlan(ctx.connection.id, ctx.design.id, dialect, v)}>
          <SelectTrigger size="sm" className="w-36 font-mono">
            <SelectValue placeholder={versions.length ? '타깃 버전' : '버전 없음'} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      footer={
        ready && (
          <>
            <span className="min-w-0 flex-1 text-[12px] text-fg">
              문 {st.plan!.statements.length}개
              {st.plan!.destructiveCount > 0 && (
                <span className="text-destructive"> · 데이터가 지워지는 문 {st.plan!.destructiveCount}개</span>
              )}
            </span>
            <Button size="sm" onClick={() => useNav.getState().selectView('run')}>
              <ArrowRight /> 실행으로
            </Button>
          </>
        )
      }
    >
      {st.loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 실제 DB 를 읽는 중…</div>
      ) : !st.plan ? (
        <div className="text-[13px] text-muted">{versions.length ? '타깃 버전 없음' : '설계 버전 없음'}</div>
      ) : st.plan.statements.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" /> 반영할 변경 없음</div>
      ) : (
        <>
          <PlanDriftWarning />
          {/*
            표가 먼저, SQL 이 나중이다 — 사람이 판단하는 근거는 "테이블이 어떤 모양이 되나"이고
            SQL 은 그 결과로 나가는 문이다. 순서가 뒤였을 때 SQL 서른 몇 줄이 판단을 가로막았다.
          */}
          <PlanTables />
          {st.plan.destructiveCount > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {/* "파괴적 문"은 쓰지 않는다 — 무엇이 어떻게 되는지가 안 담긴 번역어다. */}
              <AlertTriangle className="size-4" /> 데이터가 지워지는 문이 {st.plan.destructiveCount}개
              있습니다. 실행 전에 사람이 확인해야 합니다.
            </div>
          )}
          {st.plan.unsupported.length > 0 && (
            <div className="rounded-md bg-panel px-3 py-2 text-[11.5px] text-muted">
              자동 생성 불가(수동 처리): {st.plan.unsupported.join(' · ')}
            </div>
          )}

          {/* 적용과 되돌리기를 나란히 — 무엇을 물릴 수 있는지 밀기 전에 보여야 한다. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SqlSection title="적용 SQL" count={st.plan.statements.length}>
              <StatementGroups statements={st.plan.statements} />
            </SqlSection>
            <SqlSection
              title="되돌리기 SQL"
              count={st.revert?.statements.length ?? 0}
              note={
                st.revert && st.revert.lossy.length > 0 ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
                    {st.revert.lossy.length}개는 되돌려도 데이터가 안 돌아옵니다. 구조만 되살아납니다.
                  </div>
                ) : undefined
              }
            >
              {st.revert && <StatementGroups statements={st.revert.statements} />}
            </SqlSection>
          </div>
        </>
      )}
    </Shell>
  )
}

/**
 * 계획 위에 뜨는 드리프트 경고 — 이 계획은 **설계를 정답으로 놓고** 실제를 거기 맞춘다.
 * 그래서 남이 실 DB 에 넣은 것이 설계에 없으면 DROP 이 된다.
 */
function PlanDriftWarning(): ReactElement | null {
  const diagnosis = useMigrationStore((s) => s.diagnosis)
  const selectView = useNav((s) => s.selectView)
  if (!diagnosis || !diffHasDrift(diagnosis) || !diagnosis.drift) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="size-4" /> 실 DB 가 설계와 다릅니다
        </div>
        <DriftScale diff={diagnosis.drift} />
        <span className="text-fg">
          이 계획은 설계를 정답으로 놓고 실제를 맞춥니다. 위 변경이 설계에 없으면 지워집니다.
        </span>
        <button type="button" className="self-start underline underline-offset-2" onClick={() => selectView('diagnose')}>
          진단에서 확인
        </button>
      </div>
      <ScopeNotice />
    </div>
  )
}

// ═══════════════════════════ 실행 ═══════════════════════════
export function RunView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const selectView = useNav((s) => s.selectView)
  if (!ctx) return fallback!
  const plan = st.plan
  const drifted = !!st.diagnosis && diffHasDrift(st.diagnosis)
  const needsAck = !!plan && plan.destructiveCount > 0
  // 게이트가 둘이다: 파괴적 문(내가 만든 위험)과 드리프트(남이 만든 위험). 성격이 달라 따로 묻는다.
  const canRun =
    !!plan &&
    plan.statements.length > 0 &&
    !st.tx &&
    !st.loading &&
    (!needsAck || st.destructiveAck) &&
    (!drifted || st.driftAck)

  return (
    <Shell title="실행" ctx={ctx}>
      {st.interrupted && (
        <div className="flex flex-col gap-2 rounded-md bg-accent-soft/60 px-3 py-2.5 text-[12px] ring-1 ring-accent/30">
          <div className="flex items-center gap-2 font-semibold text-accent-2">
            <AlertTriangle className="size-4" /> 멈췄습니다
          </div>
          <span className="text-fg">{st.interrupted.detail}</span>
          <Button size="sm" variant="outline" className="self-start" onClick={() => selectView('plan')}>
            <RefreshCw /> 계획 다시 만들기
          </Button>
        </div>
      )}

      {!plan || plan.statements.length === 0 ? (
        <div className="text-[13px] text-muted">계획 없음</div>
      ) : (
        <>
          <div className="text-[13px] text-fg">
            반영 계획: <b>{plan.statements.length}</b>개 문
            {plan.destructiveCount > 0 && (
              <span className="text-destructive"> · 데이터가 지워지는 문 {plan.destructiveCount}개</span>
            )}
          </div>

          {drifted && !st.tx && (
            <div className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" /> 실 DB 가 설계와 다릅니다
              </div>
              {st.diagnosis?.drift && <DriftScale diff={st.diagnosis.drift} />}
              <span className="text-fg">이대로 반영하면 그 변경이 덮일 수 있습니다.</span>
              <button type="button" className="self-start underline underline-offset-2" onClick={() => selectView('diagnose')}>
                진단에서 확인
              </button>
              <label className="flex cursor-pointer items-center gap-2 pt-0.5">
                <Checkbox checked={st.driftAck} onCheckedChange={(c) => st.setDriftAck(c === true)} />
                확인했고 이대로 반영합니다
              </label>
            </div>
          )}

          {needsAck && !st.tx && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <Checkbox checked={st.destructiveAck} onCheckedChange={(c) => st.setDestructiveAck(c === true)} />
              데이터가 지워지는 것(DROP 등)을 알고 실행에 동의합니다
            </label>
          )}

          {!st.tx ? (
            <div>
              <Button size="sm" disabled={!canRun} onClick={() => void st.run(ctx.connection.id, ctx.design.id)}>
                {st.loading ? <Loader2 className="animate-spin" /> : <Play />} 트랜잭션으로 실행
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft/50 px-3 py-2.5 text-[12.5px]">
              <span className="min-w-0 flex-1">
                {st.tx.statements}개 문 실행됨 · 영향 <b className="font-mono">{st.tx.affected}</b>행 · 아직 커밋되지 않았습니다
              </span>
              <Button size="sm" variant="ghost" onClick={() => void st.rollback()}>롤백</Button>
              <Button size="sm" onClick={() => void st.confirm(ctx.connection.id, ctx.design.id)}>커밋</Button>
            </div>
          )}

          {st.revert && st.revert.statements.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">
                <Undo2 className="size-3.5" /> 되돌리기 SQL
                <span className="font-normal text-muted">반영 뒤 물릴 때 쓸 문</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto pr-0.5">
                <StatementGroups statements={st.revert.statements} />
              </div>
            </section>
          )}

          <p className="text-[11.5px] text-muted">
            밀기 직전에 실 DB 를 다시 읽어 남이 먼저 바꿨는지 봅니다. 문과 문 사이는 보지 않습니다.
            MySQL 은 DDL 이 즉시 커밋되므로 반영 뒤에는 되돌리기 SQL 로만 물릴 수 있습니다.
          </p>
        </>
      )}
    </Shell>
  )
}

// ═══════════════════════════ Logs ═══════════════════════════
const KIND_LABEL: Record<string, string> = {
  map: '맵핑',
  baseline: '기준선',
  drift: '드리프트',
  apply: '반영',
  'seed-apply': '시드'
}

export function LogsView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const cid = ctx?.connection.id
  const did = ctx?.design.id
  useEffect(() => {
    if (cid && did) void useMigrationStore.getState().loadLogs(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])
  if (!ctx) return fallback!

  return (
    <Shell
      title="Logs"
      ctx={ctx}
      actions={
        <Button size="sm" variant="outline" onClick={() => void st.loadLogs(ctx.connection.id, ctx.design.id)}><RefreshCw /> 새로고침</Button>
      }
    >
      {st.logs.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-muted"><ScrollText className="size-4" /> 아직 이력이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {st.logs.map((l) => (
            <div key={l.id} className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2 text-[12px]">
              <div className="flex items-center gap-3">
                {l.status === 'success' ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-destructive" />}
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                {/* 버전이 양쪽 다 비면 "— → —" 만 남아 자리만 먹는다(드리프트 기록이 대개 그렇다). */}
                {(l.fromVersion || l.toVersion) && (
                  <span className="shrink-0 font-mono text-muted">
                    {l.fromVersion || '—'} <ArrowRight className="inline size-3" /> {l.toVersion || '—'}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-fg">{l.summary}</span>
                <span className="shrink-0 text-[11px] text-muted">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
              {/* 상세가 기록의 값어치다 — 어느 테이블이 어떻게 달랐나. 안 보이면 남긴 뜻이 없다. */}
              {l.detail && <div className="pl-[26px] font-mono text-[11px] text-muted">{l.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
