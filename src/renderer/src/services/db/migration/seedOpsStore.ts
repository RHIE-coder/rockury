import { create } from 'zustand'
import { buildSelect } from '../console/data/sqlBuilder'
import type { DialectId } from '../dialects'
import type { TableDef } from '../workspaces/definition/types'
import { planSeedApply, type SeedApplyPlan } from '../workspaces/seed/seedApplyPlan'
import { planSeedImport, type SeedImportCandidate, type SeedImportPlan } from '../workspaces/seed/seedImportPlan'
import { seedVariables } from '../workspaces/seed/seedRows'
import { seedApplyReadiness } from '../workspaces/seed/seedSet'
import type { SeedSet } from '../workspaces/seed/types'

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
  tx: { txId: string; affected: number; statements: number } | null

  importPlan: SeedImportPlan | null
  accepted: Record<string, boolean>

  ensureEnv: (ctx: SeedOpsContext) => Promise<string | null>
  loadVariables: (ctx: SeedOpsContext) => Promise<void>
  setVariable: (ctx: SeedOpsContext, name: string, value: string) => Promise<void>
  setIncludeDeletes: (v: boolean) => void

  buildPlan: (ctx: SeedOpsContext) => Promise<void>
  run: (ctx: SeedOpsContext) => Promise<void>
  commit: (ctx: SeedOpsContext) => Promise<void>
  rollback: () => Promise<void>

  loadImport: (ctx: SeedOpsContext) => Promise<void>
  toggleAccept: (key: string) => void
  acceptedCandidates: () => SeedImportCandidate[]
  clearImport: () => void
}

/** 후보의 안정 키 — 체크 상태를 붙일 이름. */
export const candidateKey = (c: SeedImportCandidate): string => `${c.table}::${c.status}::${c.label}`

/** 시드 세트가 걸치는 테이블들의 현재 행을 읽는다(반영 준비된 세트만 — 나머지는 계획에서 막힌다). */
async function fetchCurrent(
  ctx: SeedOpsContext
): Promise<{ current: Record<string, Record<string, unknown>[]>; truncated: string[] }> {
  const current: Record<string, Record<string, unknown>[]> = {}
  const truncated: string[] = []
  const byName = new Map(ctx.tables.map((t) => [t.name, t]))

  for (const set of ctx.sets) {
    if (!seedApplyReadiness(set, byName.get(set.tableName)).ready) continue
    const st = buildSelect(ctx.dialect, set.tableName, { limit: ROW_FETCH_CAP, offset: 0 })
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
    try {
      const { txId } = await window.rockury.query.txBegin(ctx.connectionId)
      let affected = 0
      for (const s of steps) {
        const r = await window.rockury.query.txExecParams(txId, s.statement.sql, s.statement.params)
        affected += r.affectedRows ?? 0
      }
      set({ tx: { txId, affected, statements: steps.length }, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false, tx: null })
    }
  },

  commit: async (ctx) => {
    const { tx, envId } = get()
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      if (envId)
        await window.rockury.migration.appendLog({
          envId,
          kind: 'seed-apply',
          fromVersion: '',
          toVersion: '',
          summary: `시드 반영 ${tx.statements}개 문 · 영향 ${tx.affected}행`
        })
      set({ tx: null, plan: null })
      await get().buildPlan(ctx)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), tx: null })
    }
  },

  rollback: async () => {
    const { tx } = get()
    if (!tx) return
    try {
      await window.rockury.query.txRollback(tx.txId)
    } finally {
      set({ tx: null })
    }
  },

  loadImport: async (ctx) => {
    set({ loading: true, error: null, importPlan: null, accepted: {} })
    try {
      const { current, truncated } = await fetchCurrent(ctx)
      const importPlan = planSeedImport({ sets: ctx.sets, tables: ctx.tables, current })
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
