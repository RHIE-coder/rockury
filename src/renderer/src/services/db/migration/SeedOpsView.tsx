import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Download, Layers, Loader2, Play, Server, Sprout } from 'lucide-react'
import { Badge } from '@renderer/ui/badge'
import { Button } from '@renderer/ui/button'
import { Checkbox } from '@renderer/ui/checkbox'
import { Input } from '@renderer/ui/input'
import { PlaceholderView } from '@renderer/ui/PlaceholderView'
import { cn } from '@renderer/lib/utils'
import { useActiveConnection } from '../connections/store'
import { useActiveDesign } from '../designs/store'
import { useDesignTables } from '../workspaces/definition/store'
import { useDesignSeedSets, useSeedStore } from '../workspaces/seed/store'
import { seedSetsToCreate, seedSourceOptions, SOURCE_BLOCK_LABEL } from '../workspaces/seed/seedSource'
import type { SeedImportCandidate } from '../workspaces/seed/seedImportPlan'
import { candidateKey, useSeedOpsStore, type SeedOpsContext } from './seedOpsStore'

/**
 * Migration › Seed — **설계 시드를 실 DB 에 반영**하고, **실 DB 행을 설계로 되먹인다**.
 * 정본: `docs/spec/db-design.md` Section `db-design.seed.apply-contract`.
 *
 * 계산은 순수 모듈이 하고 이 화면은 계획을 보이고 확인을 받는다 —
 * 쓰기는 전부 트랜잭션 게이트(영향 행수 확인 → 커밋/롤백)를 지난다.
 */

type Tab = 'apply' | 'import'

function Guard({ title, sub }: { title: string; sub?: string }): ReactElement {
  return <PlaceholderView icon={Sprout} depth="depth 3 · Migration › Seed" title={title} subtitle={sub} />
}

/** 변수 값 입력 — 시드가 요구하는 변수와 채움 여부만 보인다(값은 화면에 되돌려주지 않는다). */
function VariablesPanel({ ctx }: { ctx: SeedOpsContext }): ReactElement | null {
  const required = useSeedOpsStore((s) => s.requiredVariables)
  const variables = useSeedOpsStore((s) => s.variables)
  const setVariable = useSeedOpsStore((s) => s.setVariable)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const filled = useMemo(() => new Set(variables.filter((v) => v.hasValue).map((v) => v.name)), [variables])

  if (required.length === 0) return null

  return (
    <section className="rounded-[10px] border border-line">
      <div className="border-b border-line bg-panel px-3 py-2 text-[12px] font-semibold text-fg">
        이 환경의 변수 값
        <span className="ml-2 font-normal text-muted">
          시드의 <span className="font-mono">{'{{이름}}'}</span> 을 반영할 때 채웁니다 — 값은 OS 키체인으로 암호화해
          저장되고 화면에 다시 보이지 않아요.
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {required.map((name) => (
          <div key={name} className="flex items-center gap-2" data-seed-var-row={name}>
            <span className="w-52 shrink-0 truncate font-mono text-[12px] text-fg">{name}</span>
            {filled.has(name) ? (
              <Badge variant="check" className="shrink-0">
                채워짐
              </Badge>
            ) : (
              <Badge variant="pk" className="shrink-0" data-seed-var-empty={name}>
                비어 있음
              </Badge>
            )}
            <Input
              type="password"
              value={draft[name] ?? ''}
              placeholder="값 입력"
              data-seed-var-input={name}
              onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
              className="h-7 max-w-72 text-[12px]"
            />
            <Button
              size="sm"
              variant="soft"
              disabled={!(draft[name] ?? '').trim()}
              onClick={() => {
                void setVariable(ctx, name, draft[name] ?? '')
                setDraft((d) => ({ ...d, [name]: '' }))
              }}
            >
              저장
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

function ApplyTab({ ctx }: { ctx: SeedOpsContext }): ReactElement {
  const { plan, truncated, includeDeletes, tx, loading } = useSeedOpsStore()
  const buildPlan = useSeedOpsStore((s) => s.buildPlan)
  const run = useSeedOpsStore((s) => s.run)
  const commit = useSeedOpsStore((s) => s.commit)
  const rollback = useSeedOpsStore((s) => s.rollback)
  const setIncludeDeletes = useSeedOpsStore((s) => s.setIncludeDeletes)

  const runnable = plan && plan.blockers.length === 0
  const steps = (plan?.steps ?? []).filter((s) => includeDeletes || s.kind !== 'delete-candidate')

  return (
    <div className="flex flex-col gap-3">
      <VariablesPanel ctx={ctx} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void buildPlan(ctx)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Play />}
          계획 만들기
        </Button>
        {plan && (
          <>
            <Badge variant="check">넣기 {plan.summary.inserts}</Badge>
            <Badge variant="uk">고치기 {plan.summary.updates}</Badge>
            <Badge variant="pk">삭제 후보 {plan.summary.deleteCandidates}</Badge>
            <span className="text-[11px] text-muted">변경 없음 {plan.summary.unchanged}</span>
          </>
        )}
        {plan && plan.summary.deleteCandidates > 0 && (
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Checkbox
              checked={includeDeletes}
              onCheckedChange={(v) => setIncludeDeletes(v === true)}
              aria-label="삭제 후보도 실행"
            />
            삭제 후보도 실행 — 설계에 없는 행을 지웁니다
          </label>
        )}
      </div>

      {truncated.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2 py-1.5 text-[11.5px] text-warning">
          <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
          {truncated.join(', ')} 의 행이 조회 상한에 걸렸어요 — 계획이 전체를 반영하지 못했을 수 있어요.
        </div>
      )}

      {plan && plan.blockers.length > 0 && (
        <section data-seed-blockers className="rounded-[10px] border border-danger/40">
          <div className="border-b border-line bg-danger/5 px-3 py-2 text-[12px] font-semibold text-danger">
            먼저 해결해야 할 것 {plan.blockers.length}개 — 하나라도 남으면 반영하지 않아요(반쯤 심고 마는 상태 금지)
          </div>
          <ul className="flex flex-col gap-1 px-3 py-2">
            {plan.blockers.map((b, i) => (
              <li key={i} className="text-[11.5px] text-fg">
                <span className="font-mono text-muted">{b.table}</span>
                {b.label && <span className="font-mono text-muted"> · {b.label}</span>} — {b.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && steps.length > 0 && (
        <section className="overflow-hidden rounded-[10px] border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
            <span className="text-[12px] font-semibold text-fg">실행할 문장 {steps.length}개</span>
            <span className="text-[11px] text-muted">순서는 참조 관계로 정렬됩니다</span>
            {runnable && !tx && (
              <Button size="sm" className="ml-auto" onClick={() => void run(ctx)} disabled={loading}>
                <Play />
                적용
              </Button>
            )}
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-auto">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-1.5" data-seed-step={s.kind}>
                <Badge
                  variant={s.kind === 'insert' ? 'check' : s.kind === 'update' ? 'uk' : 'pk'}
                  className="mt-[1px] shrink-0"
                >
                  {s.kind === 'insert' ? '넣기' : s.kind === 'update' ? '고치기' : '삭제 후보'}
                </Badge>
                <span className="shrink-0 font-mono text-[11.5px] text-muted">{s.table}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-fg">{s.label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={s.statement.sql}>
                  {s.statement.sql}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && plan.steps.length === 0 && plan.blockers.length === 0 && (
        <div className="flex items-center gap-1.5 rounded-md bg-panel-strong px-2 py-1.5 text-[12px] text-muted">
          <CheckCircle2 className="size-4 text-success" />
          실 DB 가 이미 설계 시드와 같아요 — 할 일이 없습니다.
        </div>
      )}

      {tx && (
        <div
          data-seed-tx-gate
          className="flex flex-wrap items-center gap-2 rounded-[10px] border border-warning/50 bg-warning-soft px-3 py-2"
        >
          <AlertTriangle className="size-4 text-warning" />
          <span className="text-[12px] font-semibold text-warning">아직 커밋되지 않았어요</span>
          <span className="text-[11.5px] text-warning/90">
            {tx.statements}개 문 실행 · 영향 {tx.affected}행 — 확인하고 확정하세요.
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => void rollback(ctx)}>
              롤백
            </Button>
            <Button size="sm" onClick={() => void commit(ctx)}>
              커밋
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<SeedImportCandidate['status'], string> = {
  new: '설계에 없음',
  changed: '값이 다름',
  'only-in-design': '실 DB 에 없음'
}

/**
 * 대상 테이블 고르기 — 실 DB 에서 행을 읽어 올 표.
 *
 * 세트가 없는 테이블도 여기 선다. 그게 이 화면이 생긴 까닭이다: 운영 DB 를 방금 가져온 설계는
 * 세트가 0개라, 예전에는 되먹임이 통째로 막혀 admin 계정·Role 을 손으로 다시 쳐 넣어야 했다.
 */
function SourcePicker({ ctx }: { ctx: SeedOpsContext }): ReactElement {
  const sources = useSeedOpsStore((s) => s.sources)
  const initSources = useSeedOpsStore((s) => s.initSources)
  const toggleSource = useSeedOpsStore((s) => s.toggleSource)
  const setSources = useSeedOpsStore((s) => s.setSources)
  const [q, setQ] = useState('')

  useEffect(() => {
    initSources(ctx)
    // 설계가 바뀌면 고른 것도 의미가 없다 — 그때 다시 기본값으로.
  }, [ctx.designId]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () => seedSourceOptions(ctx.tables, ctx.sets, ctx.defaultSchema),
    [ctx.tables, ctx.sets, ctx.defaultSchema]
  )
  const picked = new Set(sources ?? [])
  const key = q.trim().toLowerCase()
  const shown = key ? options.filter((o) => o.tableName.toLowerCase().includes(key)) : options
  const takeable = options.filter((o) => o.ready)

  return (
    <section className="overflow-hidden rounded-[10px] border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <span className="text-[12px] font-semibold text-fg">대상 테이블</span>
        {/* "0 / 14" 는 표가 14개라는 말로 읽혔다 — 고른 수만 말하고, 몇 개까지 고를 수 있는지는 `전부` 가 맡는다. */}
        <span className="text-[11.5px] text-muted">
          {picked.size > 0 ? `${picked.size}개 고름` : '고른 것 없음'}
        </span>
        <span className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSources(takeable.map((o) => o.tableName))}
            disabled={picked.size === takeable.length}
          >
            전부
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSources([])} disabled={picked.size === 0}>
            해제
          </Button>
        </span>
      </div>
      <div className="border-b border-line px-3 py-1.5">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="테이블 검색…"
          className="h-7 text-[12px]"
        />
      </div>
      {shown.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted">해당 테이블 없음</div>
      ) : (
        <ul className="max-h-64 divide-y divide-line overflow-auto">
          {shown.map((o) => (
            <li key={o.tableName} className="flex items-center gap-2 px-3 py-1.5" data-seed-source={o.tableName}>
              <Checkbox
                checked={picked.has(o.tableName)}
                disabled={!o.ready}
                onCheckedChange={() => toggleSource(o.tableName)}
                aria-label={o.tableName}
              />
              <span className={cn('font-mono text-[12px]', o.ready ? 'text-fg' : 'text-muted')}>
                {/* 스키마를 앞에 붙여 어느 표인지 못박는다 — 이름만 보이면 같은 이름끼리 헷갈린다. */}
                {o.schema && <span className="text-muted">{o.schema}.</span>}
                {o.tableName}
              </span>
              {o.hasSet && <Badge variant="check">시드 있음</Badge>}
              {o.ready ? (
                <span className="truncate font-mono text-[11px] text-muted">짝짓기 {o.naturalKey.join(', ')}</span>
              ) : (
                <span className="truncate text-[11px] text-warning">
                  {o.reason ? SOURCE_BLOCK_LABEL[o.reason] : '읽을 수 없음'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ImportTab({ ctx }: { ctx: SeedOpsContext }): ReactElement {
  const { importPlan, accepted, loading, sources } = useSeedOpsStore()
  const loadImport = useSeedOpsStore((s) => s.loadImport)
  const toggleAccept = useSeedOpsStore((s) => s.toggleAccept)
  const acceptedCandidates = useSeedOpsStore((s) => s.acceptedCandidates)
  const clearImport = useSeedOpsStore((s) => s.clearImport)
  const applyImported = useSeedStore((s) => s.applyImported)
  const ensureSets = useSeedStore((s) => s.ensureSets)

  const takeable = (importPlan?.candidates ?? []).filter((c) => c.status !== 'only-in-design')
  const chosen = takeable.filter((c) => accepted[candidateKey(c)]).length

  return (
    <div className="flex flex-col gap-3">
      <SourcePicker ctx={ctx} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void loadImport(ctx)} disabled={loading || (sources ?? []).length === 0}>
          {loading ? <Loader2 className="animate-spin" /> : <Download />}
          실 DB 읽기
        </Button>
        {importPlan && (
          <>
            <Badge variant="check">설계에 없음 {importPlan.summary.added}</Badge>
            <Badge variant="uk">값이 다름 {importPlan.summary.changed}</Badge>
            <Badge variant="idx">실 DB 에 없음 {importPlan.summary.onlyInDesign}</Badge>
          </>
        )}
        {chosen > 0 && (
          <Button
            size="sm"
            className="ml-auto"
            data-seed-import-accept
            onClick={() => {
              const items = acceptedCandidates()
              // 세트가 없는 테이블은 **먼저 만든다** — 없으면 담기가 조용히 아무것도 안 한다.
              ensureSets(
                ctx.designId,
                seedSetsToCreate({
                  tables: ctx.tables,
                  sets: ctx.sets,
                  tableNames: items.map((c) => c.table),
                  defaultSchema: ctx.defaultSchema
                })
              )
              applyImported(
                ctx.designId,
                items.map((c) => ({
                  table: c.table,
                  rowId: c.rowId,
                  values: c.values,
                  alias: c.suggestedAlias
                }))
              )
              clearImport()
            }}
          >
            고른 {chosen}개 설계에 담기
          </Button>
        )}
      </div>

      {importPlan && importPlan.notes.length > 0 && (
        // 알림은 행·컬럼마다 하나씩 나와 표 여럿을 고르면 벽이 된다 — 줄이지 말고 접어서 담는다.
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md bg-panel-strong px-2 py-1.5">
          {importPlan.notes.map((n, i) => (
            <li key={i} className="text-[11.5px] text-muted">
              {n}
            </li>
          ))}
        </ul>
      )}

      {importPlan && importPlan.candidates.length === 0 && (
        <div className="flex items-center gap-1.5 rounded-md bg-panel-strong px-2 py-1.5 text-[12px] text-muted">
          <CheckCircle2 className="size-4 text-success" />
          설계와 실 DB 의 시드가 같아요.
        </div>
      )}

      {importPlan && importPlan.candidates.length > 0 && (
        <section className="overflow-hidden rounded-[10px] border border-line">
          <div className="border-b border-line bg-panel px-3 py-2 text-[12px] font-semibold text-fg">
            가져올 후보 — 고른 것만 설계에 담습니다
            <span className="ml-2 font-normal text-muted">
              운영 DB 에는 설계로 올려선 안 되는 행이 섞이므로 자동으로 담지 않아요.
            </span>
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-auto">
            {importPlan.candidates.map((c) => {
              const key = candidateKey(c)
              const takeableRow = c.status !== 'only-in-design'
              return (
                <li key={key} className="flex items-start gap-2 px-3 py-1.5" data-seed-import-row={c.status}>
                  {takeableRow ? (
                    <Checkbox
                      checked={!!accepted[key]}
                      onCheckedChange={() => toggleAccept(key)}
                      aria-label="채택"
                      className="mt-[2px]"
                    />
                  ) : (
                    <span className="w-4" />
                  )}
                  <Badge
                    variant={c.status === 'new' ? 'check' : c.status === 'changed' ? 'uk' : 'idx'}
                    className="mt-[1px] shrink-0"
                  >
                    {STATUS_LABEL[c.status]}
                  </Badge>
                  <span className="shrink-0 font-mono text-[11.5px] text-muted">{c.table}</span>
                  <span className="shrink-0 font-mono text-[11.5px] text-fg">{c.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {c.status === 'changed'
                      ? c.changes?.map((ch) => `${ch.column}: ${ch.design ?? 'NULL'} → ${ch.actual ?? 'NULL'}`).join(' · ')
                      : c.status === 'new'
                        ? `별칭 제안 ${c.suggestedAlias || '없음'}`
                        : '설계에만 있는 행 — 반영하면 새로 들어갑니다'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

export function SeedOpsView(): ReactElement {
  const design = useActiveDesign()
  const connection = useActiveConnection()
  const sets = useDesignSeedSets()
  const tables = useDesignTables()
  const error = useSeedOpsStore((s) => s.error)
  const loadVariables = useSeedOpsStore((s) => s.loadVariables)
  /*
   * 세트가 없으면 **되먹임 쪽에 서서 연다** — 반영할 시드가 없는 자리에서 반영 탭을 먼저
   * 보여 줘 봐야 할 것이 없다. 재료(실 DB 행)를 들이는 것이 그때의 유일한 다음 걸음이다.
   */
  const [tab, setTab] = useState<Tab>(sets.length === 0 ? 'import' : 'apply')

  const ctx: SeedOpsContext | null =
    design && connection
      ? {
          connectionId: connection.id,
          designId: design.id,
          dialect: design.dialect,
          defaultSchema: connection.database,
          sets,
          tables
        }
      : null

  useEffect(() => {
    if (ctx) void loadVariables(ctx)
    // 세트·연결이 바뀌면 요구 변수 목록이 달라진다.
  }, [ctx?.connectionId, ctx?.designId, sets, loadVariables]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!connection) return <Guard title="연결을 선택하세요" sub="시드를 심을 대상 실 DB 를 고르세요." />
  if (!design) return <Guard title="설계를 선택하세요" sub="반영할 시드는 설계가 가지고 있어요." />
  /*
   * 세트가 없어도 화면을 막지 않는다. 예전엔 여기서 "Design › Seed 에서 먼저 저작하세요"로
   * 돌려보냈는데, 그 재료(admin 계정·Role 같은 운영 필수 행)는 이미 실 DB 에 있었다 —
   * 되먹임이 그걸 들이는 길인데 그 길이 막혀 있었다(2026-08-18 사용자).
   */

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-3 px-5 py-5">
      <div className="flex items-center gap-2">
        <Sprout className="size-4 text-muted" />
        <span className="text-[16px] font-bold tracking-tight text-fg">시드 반영</span>
        {/*
          짝 표기는 Migration 의 다른 화면(`views.tsx` 의 `Pair`)과 같은 문법이다 —
          설계가 왼쪽, 실제(연결)가 오른쪽이고 그림도 위 손잡이가 쓰는 것을 그대로 쓴다.
          화살표를 `→` 에서 `↔` 로 바꾼 건 이 줄이 **물린 짝**을 말하기 때문이다: 방향은
          오른쪽 탭이 정하는데(`apply` 는 설계→운영, `import` 는 그 반대), 여기 `→` 를 못박아
          두면 되먹임 탭에서 머리글과 화면이 서로 반대를 말했다.
        */}
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-muted">
          <Layers className="size-3.5 shrink-0" />
          <span className="truncate">{design.name}</span>
          <span aria-hidden>↔</span>
          <Server className="size-3.5 shrink-0" />
          <span className="truncate">{connection.name}</span>
        </span>
        <span className="ml-auto flex gap-1">
          {(
            [
              ['apply', '설계 → 운영', Play],
              ['import', '운영 → 설계', ArrowLeftRight]
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              data-seed-ops-tab={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                tab === id ? 'bg-accent text-white' : 'bg-panel-strong text-muted hover:text-fg'
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-md bg-danger/10 px-2 py-1.5 text-[11.5px] text-danger">
          <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {ctx &&
        (tab === 'apply' ? (
          sets.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-[10px] border border-line bg-panel/60 px-3 py-3">
              <span className="text-[12.5px] text-fg">심을 시드 없음</span>
              <Button size="sm" variant="soft" onClick={() => setTab('import')}>
                <ArrowLeftRight /> 운영에서 가져오기
              </Button>
            </div>
          ) : (
            <ApplyTab ctx={ctx} />
          )
        ) : (
          <ImportTab ctx={ctx} />
        ))}
    </div>
  )
}
