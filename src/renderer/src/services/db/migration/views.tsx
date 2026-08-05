import { useEffect, type ReactElement, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  DownloadCloud,
  Layers,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  ScrollText,
  Server,
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
import { useActiveDesign, type DesignDef } from '../designs/store'
import { useActiveConnection, type ConnectionDef } from '../connections/store'
import { useDesignVersions } from '../versions/store'
import type { SchemaDiff } from '../versions/diff'
import { isEmptyDiff } from '../versions/diff'
import { useMigrationStore } from './store'
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

const STATUS_COLOR: Record<string, string> = {
  added: 'text-success',
  removed: 'text-destructive',
  modified: 'text-accent-2'
}

function DiffSummary({ diff }: { diff: SchemaDiff }): ReactElement {
  const s = diff.summary
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-[12px] text-muted">
        <span>테이블 <b className="text-success">+{s.tablesAdded}</b> / <b className="text-accent-2">~{s.tablesModified}</b> / <b className="text-destructive">-{s.tablesRemoved}</b></span>
        <span>컬럼 <b className="text-success">+{s.columnsAdded}</b> / <b className="text-accent-2">~{s.columnsModified}</b> / <b className="text-destructive">-{s.columnsRemoved}</b></span>
        <span>제약 <b className="text-success">+{s.constraintsAdded}</b> / <b className="text-accent-2">~{s.constraintsModified}</b> / <b className="text-destructive">-{s.constraintsRemoved}</b></span>
      </div>
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
 * 짝 표기 — **설계가 왼쪽, 실제(연결)가 오른쪽**이다.
 *
 * 이 방향은 앱이 이미 쓰던 것이다: 모듈 줄이 `Design ── Migration ── Remote` 이고, 오른쪽 위
 * 손잡이도 설계 묶음이 먼저다(`db/index.tsx` 의 `handles: ['design','ops']`). 여기만 연결을
 * 왼쪽에 적고 있어서 같은 화면의 위아래가 서로 반대를 가리켰다(2026-08-04 사용자 지적).
 *
 * 아이콘을 붙이는 건 순서만으로는 안 읽히기 때문이다 — 설계와 연결에 같은 이름을 쓰는 일이
 * 흔해서(`piccard ↔ piccard`) 자리를 알아도 어느 쪽이 무엇인지 모른다. 그림은 위 손잡이가
 * 쓰는 것과 **같은 것**을 쓴다(설계=Layers, 연결=Server) — 눈이 손잡이에서 여기로 이어진다.
 *
 * 화살표가 `↔` 인 이유: 이 줄은 무엇과 무엇이 물려 있나(Environment)를 말할 뿐 흐름이 아니다.
 * 방향이 있는 건 Plan·Run(설계→실제)과 Seed 의 탭이고, 그건 각 화면이 따로 말한다.
 */
function Pair({ design, connection }: { design?: string; connection: string }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-normal text-muted">
      {design !== undefined && (
        <>
          <Layers className="size-3.5 shrink-0" />
          <span className="truncate">{design}</span>
          <span aria-hidden>↔</span>
        </>
      )}
      <Server className="size-3.5 shrink-0" />
      <span className="truncate">{connection}</span>
    </span>
  )
}

function Header({ title, ctx, children }: { title: string; ctx: Ctx; children?: ReactNode }): ReactElement {
  const binding = useMigrationStore((s) => s.binding)
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
      <div className="flex min-w-0 flex-col">
        <h2 className="flex min-w-0 items-center gap-1.5 text-[14px] font-bold text-fg">
          {title}
          <span className="font-normal text-muted">·</span>
          <Pair design={ctx.design.name} connection={ctx.connection.name} />
        </h2>
        <p className="text-[12px] text-muted">타깃 {binding?.targetVersion || '—'} · 적용 {binding?.appliedVersion || '—'}</p>
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

// ─────────────────────────── Drift [diff②] ───────────────────────────
export function DriftView(): ReactElement {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  const st = useMigrationStore()
  const cid = connection?.id
  const did = design?.id
  useEffect(() => {
    if (cid && did) void st.loadDrift(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])

  if (!connection)
    return <Guard title="연결을 선택하세요" sub="Connection 셀렉터에서 대상 실 DB 를 고르세요." />

  // 연결은 있으나 물린 설계가 없음 → 되먹임의 문(가져오기 뷰)이 부트스트랩을 맡는다.
  if (!design)
    return (
      <Guard
        title="이 연결에 물린 설계가 없습니다"
        sub="가져오기 탭에서 실 DB 를 설계로 들이면 결속이 세워집니다."
      />
    )

  const ctx: Ctx = { design, connection }
  return (
    <div className="flex h-full flex-col">
      <Header title="Drift" ctx={ctx}>
        <Button size="sm" variant="outline" disabled={st.loading} onClick={() => void st.loadDrift(ctx.connection.id, ctx.design.id)}>
          {st.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} 다시 검사
        </Button>
      </Header>
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {st.loading && !st.driftDiff && !st.hasBaseline ? (
          <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 실제 스키마를 읽는 중…</div>
        ) : !st.hasBaseline ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-panel/50 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-fg"><Camera className="size-4" /> 기준선이 없습니다</div>
            <p className="max-w-xl text-[12px] leading-relaxed text-muted">
              드리프트는 "마지막에 남긴 실제 모습(post-apply 스냅샷)"과 지금을 비교합니다. 먼저 현재 실제
              상태를 기준선으로 캡처하세요.
            </p>
            <Button size="sm" disabled={st.loading} onClick={() => void st.captureBaseline(ctx.connection.id, ctx.design.id, st.binding?.appliedVersion || '')}>
              <Camera /> 현재 상태를 기준선으로 캡처
            </Button>
          </div>
        ) : st.driftDiff && !isEmptyDiff(st.driftDiff) ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-2"><AlertTriangle className="size-4" /> 드리프트 감지됨 (기준선 {st.baselineVersion || '—'} 대비)</div>
            <DiffSummary diff={st.driftDiff} />
            <Button size="sm" variant="outline" onClick={() => void st.captureBaseline(ctx.connection.id, ctx.design.id, st.binding?.appliedVersion || '')}>
              <Camera /> 현재 상태로 기준선 갱신
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" /> 드리프트 없음 — 실제가 기준선과 일치합니다</div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────── 가져오기 [실제 → 설계] ───────────────────────
/**
 * 되먹임의 문 — 실 DB 를 역설계해 설계의 새 버전으로 들인다.
 *
 * 예전엔 Drift 머리글의 버튼 하나였다(2026-08-04 사용자 요청으로 뷰가 됐다). 이 모듈의 두 방향
 * 중 한쪽이 버튼에 숨어 있어서, 뷰 탭 줄만 보면 **반영(설계→실제)만 하는 도구**로 읽혔다.
 * 설계가 아직 없는 연결의 부트스트랩(새 설계로 컷)도 여기가 맡는다 — 그것도 되먹임이다.
 */
export function ImportView(): ReactElement {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  const openImport = useImportStore((s) => s.openImport)
  const binding = useMigrationStore((s) => s.binding)
  const driftDiff = useMigrationStore((s) => s.driftDiff)

  if (!connection)
    return <Guard title="연결을 선택하세요" sub="설계로 들일 실 DB 를 고르세요." />

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="flex min-w-0 items-center gap-1.5 text-[14px] font-bold text-fg">
            가져오기
            <span className="font-normal text-muted">·</span>
            <Pair design={design?.name} connection={connection.name} />
          </h2>
          {design && (
            <p className="text-[12px] text-muted">타깃 {binding?.targetVersion || '—'} · 적용 {binding?.appliedVersion || '—'}</p>
          )}
        </div>
        <Button size="sm" onClick={() => openImport(connection, design ?? null)}>
          <DownloadCloud /> {design ? '설계로 가져오기' : '새 설계로 가져오기'}
        </Button>
      </div>
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!design ? (
          <div className="text-[13px] text-muted">물린 설계 없음 — 가져오면 첫 버전과 결속이 함께 세워집니다</div>
        ) : driftDiff && !isEmptyDiff(driftDiff) ? (
          // Drift 를 이미 돌렸으면 그 결과가 곧 "들일 것"이다 — 여기서 또 읽지 않는다(같은 검사다).
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-accent-2"><AlertTriangle className="size-4" /> 들일 변경 (기준선 대비)</div>
            <DiffSummary diff={driftDiff} />
          </div>
        ) : (
          <div className="text-[13px] text-muted">들일 변경 없음 — Drift 에서 검사한 결과가 여기 모입니다</div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── Plan [diff③] ───────────────────────────
export function PlanView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const versions = useDesignVersions(ctx?.design.id ?? null)
  if (!ctx) return fallback!
  const dialect = ctx.design.dialect

  return (
    <div className="flex h-full flex-col">
      <Header title="Plan" ctx={ctx}>
        <Select value={st.targetVersion ?? st.binding?.targetVersion ?? undefined} onValueChange={(v) => void st.loadPlan(ctx.connection.id, ctx.design.id, dialect, v)}>
          <SelectTrigger size="sm" className="w-36 font-mono">
            <SelectValue placeholder={versions.length ? '타깃 버전' : '버전 없음'} />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.number} value={v.number}>{v.number}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Header>
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {st.loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> 계획 생성 중(실제 역설계 + diff)…</div>
        ) : !st.plan ? (
          <div className="text-[13px] text-muted">타깃 버전을 선택하면 실제 DB 와의 차이를 반영 SQL 로 만들어 보여줍니다(diff③).</div>
        ) : st.plan.statements.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" /> 이미 타깃과 일치 — 반영할 변경이 없습니다</div>
        ) : (
          <div className="flex flex-col gap-4">
            {st.planDiff && <DiffSummary diff={st.planDiff} />}
            {st.plan.destructiveCount > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                <AlertTriangle className="size-4" /> 파괴적 문 {st.plan.destructiveCount}개 — 실행 전 사람 승인이 필요합니다(Run 탭)
              </div>
            )}
            {st.plan.unsupported.length > 0 && (
              <div className="rounded-md bg-panel px-3 py-2 text-[11.5px] text-muted">
                자동 생성 불가(수동 처리): {st.plan.unsupported.join(' · ')}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {st.plan.statements.map((s, i) => (
                <div key={i} className="rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px]">
                  <div className="mb-1 flex gap-1.5">
                    <Badge variant={s.destructive ? 'destructive' : 'secondary'} className="px-1 py-0 text-[10px]">
                      {s.kind}{s.destructive ? ' ⚠' : ''}
                    </Badge>
                    <span className="text-muted">{s.table}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-fg">{s.sql}</div>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-muted"><ArrowRight className="mr-1 inline size-3.5" />Run 탭에서 트랜잭션으로 실행하고 커밋/롤백을 결정하세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── Run ───────────────────────────
export function RunView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  if (!ctx) return fallback!
  const plan = st.plan
  const needsAck = !!plan && plan.destructiveCount > 0
  const canRun = !!plan && plan.statements.length > 0 && !st.tx && !st.loading && (!needsAck || st.destructiveAck)

  return (
    <div className="flex h-full flex-col">
      <Header title="Run" ctx={ctx} />
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!plan || plan.statements.length === 0 ? (
          <div className="text-[13px] text-muted">Plan 탭에서 타깃 버전을 골라 계획을 먼저 생성하세요.</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-[13px] text-fg">
              반영 계획: <b>{plan.statements.length}</b>개 문
              {plan.destructiveCount > 0 && <span className="text-destructive"> · 파괴적 {plan.destructiveCount}개</span>}
            </div>

            {needsAck && !st.tx && (
              <label className="flex cursor-pointer items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                <Checkbox checked={st.destructiveAck} onCheckedChange={(c) => st.setDestructiveAck(c === true)} />
                파괴적 변경(DROP 등)을 이해했고 실행에 동의합니다
              </label>
            )}

            {!st.tx ? (
              <div>
                <Button size="sm" disabled={!canRun} onClick={() => void st.run(ctx.connection.id)}>
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
            <p className="text-[11.5px] text-muted">
              커밋 성공 시 post-apply 스냅샷 저장 + 적용 버전 갱신 + 로그 기록. (MySQL 은 DDL 이 즉시
              커밋되므로 롤백이 제한적입니다.)
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── Logs ───────────────────────────
const KIND_LABEL: Record<string, string> = { baseline: '기준선', drift: '드리프트', apply: '반영' }

export function LogsView(): ReactElement {
  const { ctx, fallback } = useCtx()
  const st = useMigrationStore()
  const cid = ctx?.connection.id
  const did = ctx?.design.id
  useEffect(() => {
    if (cid && did) void st.loadLogs(cid, did)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, did])
  if (!ctx) return fallback!

  return (
    <div className="flex h-full flex-col">
      <Header title="Logs" ctx={ctx}>
        <Button size="sm" variant="outline" onClick={() => void st.loadLogs(ctx.connection.id, ctx.design.id)}><RefreshCw /> 새로고침</Button>
      </Header>
      <ErrorBar />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {st.logs.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-muted"><ScrollText className="size-4" /> 아직 이력이 없습니다</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {st.logs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-md border border-line bg-canvas px-3 py-2 text-[12px]">
                {l.status === 'success' ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-destructive" />}
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                <span className="font-mono text-muted">
                  {l.fromVersion || '—'} <ArrowRight className="inline size-3" /> {l.toVersion || '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg">{l.summary}</span>
                <span className="shrink-0 text-[11px] text-muted">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
