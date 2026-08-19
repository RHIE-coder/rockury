import { create } from 'zustand'
import { buildSelect } from '../remote/data/sqlBuilder'
import type { DialectId } from '../dialects'
import type { TableDef } from '../workspaces/definition/types'
import { planSeedApply, type SeedApplyPlan, type SeedApplyStep } from '../workspaces/seed/seedApplyPlan'
import { planSeedImport, type SeedImportCandidate, type SeedImportPlan } from '../workspaces/seed/seedImportPlan'
import { seedVariables } from '../workspaces/seed/seedRows'
import { seedApplyReadiness } from '../workspaces/seed/seedSet'
import { defaultSeedSources, seedSourceOptions, seedSourceSets } from '../workspaces/seed/seedSource'
import type { SeedSet } from '../workspaces/seed/types'
import { logTargetOf, outcomeLogDetail, seedApplyLogDetail } from './logDetail'

/**
 * 시드 반영·되먹임 오케스트레이션 — 계산은 순수 모듈(`seedApplyPlan`·`seedImportPlan`)이 하고
 * 여기서는 **실 DB 조회 · 트랜잭션 게이트 · 저장**만 한다.
 *
 * 실 DB 쓰기는 반드시 트랜잭션 게이트를 지난다(서비스 공통 불변식) —
 * `txBegin → txExecParams … → [커밋]/[롤백]`. 사람이 영향 행수를 보고 확정한다.
 */

/** 한 테이블에서 읽어올 행 상한 — 넘으면 계획이 불완전해지므로 **알린다**(조용한 절단 금지). */
export const ROW_FETCH_CAP = 2000

/** 환경 변수 정보(preload 와 같은 형태 — 렌더러가 preload 를 직접 import 하지 않는 관례). */
export interface EnvVariableInfo {
  envId: string
  name: string
  hasValue: boolean
  updatedAt: string
}

export interface SeedOpsContext {
  connectionId: string
  designId: string
  dialect: DialectId
  /**
   * 이 연결의 기본 DB. 시드는 테이블을 이름으로만 가리켜 여기로만 나간다
   * (`seedApplyPlan` 의 `target` 주석) — 밖에 있는 표는 고르지 못하게 막는 근거다.
   */
  defaultSchema: string
  sets: SeedSet[]
  tables: TableDef[]
}

interface SeedOpsState {
  loading: boolean
  error: string | null
  /** 환경(connection×design 바인딩) id — 변수 값 스코프. */
  envId: string | null
  variables: EnvVariableInfo[]
  /** 시드가 요구하는 변수 이름(설계에서 추출). */
  requiredVariables: string[]

  plan: SeedApplyPlan | null
  /** 조회 상한에 걸린 테이블 — 계획이 불완전하다는 사실을 화면에 알린다. */
  truncated: string[]
  includeDeletes: boolean
  /** 실행한 걸음을 함께 든다 — 커밋 기록의 상세("어느 행을 넣고 고쳤나")가 여기서 나온다. */
  tx: { txId: string; affected: number; statements: number; steps: SeedApplyStep[] } | null

  importPlan: SeedImportPlan | null
  accepted: Record<string, boolean>
  /**
   * 되먹임으로 **행을 읽어 올 테이블**. null 이면 아직 안 정했다는 뜻이라, 화면이 열릴 때
   * 기본값(이미 세트가 있는 것)으로 채운다 — 빈 배열("아무것도 안 고름")과 갈라야 한다.
   */
  sources: string[] | null
  /** 그 고름이 어느 설계의 것인가 — 설계가 바뀌면 앞 설계의 표 이름은 뜻이 없다. */
  sourcesFor: string | null

  ensureEnv: (ctx: SeedOpsContext) => Promise<string | null>
  loadVariables: (ctx: SeedOpsContext) => Promise<void>
  setVariable: (ctx: SeedOpsContext, name: string, value: string) => Promise<void>
  setIncludeDeletes: (v: boolean) => void

  buildPlan: (ctx: SeedOpsContext) => Promise<void>
  run: (ctx: SeedOpsContext) => Promise<void>
  commit: (ctx: SeedOpsContext) => Promise<void>
  rollback: (ctx?: SeedOpsContext) => Promise<void>

  /** 대상 테이블 목록을 아직 안 정했으면 기본값으로 채운다. */
  initSources: (ctx: SeedOpsContext) => void
  toggleSource: (tableName: string) => void
  setSources: (tableNames: string[]) => void
  loadImport: (ctx: SeedOpsContext) => Promise<void>
  toggleAccept: (key: string) => void
  acceptedCandidates: () => SeedImportCandidate[]
  clearImport: () => void
}

/** 성공이 아닌 끝(실패·롤백)을 남긴다 — 기록 남기기가 실패해도 본 오류 문구를 덮지 않는다. */
async function logOutcome(
  envId: string | null,
  connectionId: string,
  status: 'error' | 'rolled-back',
  attempted: string,
  cause?: unknown
): Promise<void> {
  if (!envId) return
  const target = await logTargetOf(connectionId)
  const message = cause instanceof Error ? cause.message : cause ? String(cause) : undefined
  try {
    await window.rockury.migration.appendLog({
      envId,
      kind: 'seed-apply',
      status,
      summary: attempted,
      detail: target ? outcomeLogDetail({ target, attempted, message }) : message
    })
  } catch {
    // 기록이 안 남아도 반영 흐름을 막지 않는다.
  }
}

/** 후보의 안정 키 — 체크 상태를 붙일 이름. */
export const candidateKey = (c: SeedImportCandidate): string => `${c.table}::${c.status}::${c.label}`

/**
 * 주어진 세트들이 걸치는 테이블의 현재 행을 읽는다(반영 준비된 세트만 — 나머지는 계획에서 막힌다).
 * 세트를 밖에서 받는 이유: 되먹임은 **설계에 아직 없는 테이블**도 읽는다(빈 세트를 물려 부른다).
 */
async function fetchCurrent(
  ctx: SeedOpsContext,
  sets: SeedSet[] = ctx.sets
): Promise<{ current: Record<string, Record<string, unknown>[]>; truncated: string[] }> {
  const current: Record<string, Record<string, unknown>[]> = {}
  const truncated: string[] = []
  const byName = new Map(ctx.tables.map((t) => [t.name, t]))

  for (const set of sets) {
    if (!seedApplyReadiness(set, byName.get(set.tableName)).ready) continue
    // 이름만 — 설계 테이블의 `schema` 는 설계부 기본값(`public`)이라 대상 DB 의 실제 스키마가
    // 아니다(자세한 이유는 seedApplyPlan 의 `target`). 반영 계획이 쓰는 이름과 같아야 한다.
    const st = buildSelect(ctx.dialect, { name: set.tableName }, { limit: ROW_FETCH_CAP, offset: 0 })
    const res = await window.rockury.query.runParams(ctx.connectionId, st.sql, st.params)
    const rows = (res.rows ?? []) as Record<string, unknown>[]
    current[set.tableName] = rows
    if (rows.length >= ROW_FETCH_CAP) truncated.push(set.tableName)
  }
  return { current, truncated }
}

export const useSeedOpsStore = create<SeedOpsState>()((set, get) => ({
  loading: false,
  error: null,
  envId: null,
  variables: [],
  requiredVariables: [],
  plan: null,
  truncated: [],
  includeDeletes: false,
  tx: null,
  importPlan: null,
  accepted: {},
  sources: null,
  sourcesFor: null,

  ensureEnv: async (ctx) => {
    if (get().envId) return get().envId
    try {
      const env = await window.rockury.environments.ensure(ctx.connectionId, ctx.designId, '')
      set({ envId: env.id })
      return env.id
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  loadVariables: async (ctx) => {
    const envId = await get().ensureEnv(ctx)
    if (!envId) return
    const names = new Set<string>()
    for (const s of ctx.sets) for (const n of seedVariables(s.rows)) names.add(n)
    const variables = await window.rockury.envVars.list(envId)
    set({ variables, requiredVariables: [...names].sort() })
  },

  setVariable: async (ctx, name, value) => {
    const envId = await get().ensureEnv(ctx)
    if (!envId) return
    await window.rockury.envVars.set(envId, name, value)
    await get().loadVariables(ctx)
    // 값이 채워지면 계획이 달라진다 — 옛 계획을 들고 있으면 오해한다.
    set({ plan: null })
  },

  setIncludeDeletes: (v) => set({ includeDeletes: v }),

  buildPlan: async (ctx) => {
    set({ loading: true, error: null, plan: null, tx: null })
    try {
      const envId = await get().ensureEnv(ctx)
      const variables = envId ? await window.rockury.envVars.resolve(envId) : {}
      const { current, truncated } = await fetchCurrent(ctx)
      const plan = planSeedApply({
        sets: ctx.sets,
        tables: ctx.tables,
        dialect: ctx.dialect,
        current,
        variables
      })
      set({ plan, truncated, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  run: async (ctx) => {
    const { plan, includeDeletes } = get()
    if (!plan || plan.blockers.length > 0) return
    const steps = plan.steps.filter((s) => includeDeletes || s.kind !== 'delete-candidate')
    if (steps.length === 0) return
    set({ loading: true, error: null })
    // txId 를 밖에 둔다 — 문이 도중에 터지면 잡아서 닫아야 한다(안 닫으면 실 DB 에 잠금이 남는다).
    let opened: string | null = null
    let done = 0
    try {
      opened = (await window.rockury.query.txBegin(ctx.connectionId)).txId
      let affected = 0
      for (const s of steps) {
        const r = await window.rockury.query.txExecParams(opened, s.statement.sql, s.statement.params)
        affected += r.affectedRows ?? 0
        done++
      }
      set({ tx: { txId: opened, affected, statements: steps.length, steps }, loading: false })
    } catch (e) {
      if (opened) await window.rockury.query.txRollback(opened).catch(() => {})
      await logOutcome(
        get().envId,
        ctx.connectionId,
        'error',
        `문 ${steps.length}개 중 ${done}개째에서 실패`,
        e
      )
      set({ error: e instanceof Error ? e.message : String(e), loading: false, tx: null })
    }
  },

  commit: async (ctx) => {
    const { tx, envId } = get()
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      if (envId) {
        const target = await logTargetOf(ctx.connectionId)
        await window.rockury.migration.appendLog({
          envId,
          kind: 'seed-apply',
          fromVersion: '',
          toVersion: '',
          summary: `문 ${tx.statements}개 · 영향 ${tx.affected}행`,
          // 어느 행을 건드렸나가 시드 기록의 값어치다 — 값(파라미터)은 안 담는다(환경 비밀).
          detail: target
            ? seedApplyLogDetail({ target, steps: tx.steps, affected: tx.affected })
            : undefined
        })
      }
      set({ tx: null, plan: null })
      await get().buildPlan(ctx)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), tx: null })
    }
  },

  rollback: async (ctx) => {
    const { tx } = get()
    if (!tx) return
    try {
      await window.rockury.query.txRollback(tx.txId)
    } finally {
      // 물린 것도 남긴다 — "심었다가 되돌렸다"는 감사에서 성공만큼 중요한 사실이다.
      if (ctx)
        await logOutcome(
          get().envId,
          ctx.connectionId,
          'rolled-back',
          `문 ${tx.statements}개 실행 뒤 롤백`
        )
      set({ tx: null })
    }
  },

  initSources: (ctx) => {
    if (get().sourcesFor === ctx.designId) return
    set({
      sources: defaultSeedSources(seedSourceOptions(ctx.tables, ctx.sets, ctx.defaultSchema)),
      sourcesFor: ctx.designId,
      importPlan: null,
      accepted: {}
    })
  },

  toggleSource: (tableName) =>
    set((s) => {
      const cur = s.sources ?? []
      return {
        sources: cur.includes(tableName) ? cur.filter((x) => x !== tableName) : [...cur, tableName],
        // 대상이 바뀌면 앞서 읽은 후보는 낡은 것이다 — 남겨 두면 안 고른 테이블의 행을 담게 된다.
        importPlan: null,
        accepted: {}
      }
    }),

  setSources: (tableNames) => set({ sources: tableNames, importPlan: null, accepted: {} }),

  loadImport: async (ctx) => {
    set({ loading: true, error: null, importPlan: null, accepted: {} })
    try {
      // 고른 테이블만 읽는다. 세트가 없는 테이블은 빈 세트를 물려 — 실 DB 행이 전부 후보가 된다.
      const sets = seedSourceSets({
        tables: ctx.tables,
        sets: ctx.sets,
        picked: get().sources ?? [],
        defaultSchema: ctx.defaultSchema
      })
      const { current, truncated } = await fetchCurrent(ctx, sets)
      const importPlan = planSeedImport({ sets, tables: ctx.tables, current })
      set({ importPlan, truncated, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  toggleAccept: (key) => set((s) => ({ accepted: { ...s.accepted, [key]: !s.accepted[key] } })),

  acceptedCandidates: () => {
    const { importPlan, accepted } = get()
    return (importPlan?.candidates ?? []).filter((c) => accepted[candidateKey(c)])
  },

  clearImport: () => set({ importPlan: null, accepted: {} })
}))
