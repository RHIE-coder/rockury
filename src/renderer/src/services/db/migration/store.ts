import { create } from 'zustand'
import type { DialectId } from '../dialects'
import { diffSnapshots, type SchemaDiff } from '../versions/diff'
import { useVersionsStore, type VersionSnapshot } from '../versions/store'
import { normalizeSchema } from '../console/introspection'
import { useEnvironmentsStore } from '../environments/store'
import { generateMigration, type MigrationPlan } from './ddlDiff'

/** migration_logs 레코드(구조적 — main/store/migration 과 동일). */
export interface MigrationLog {
  id: string
  envId: string
  kind: 'baseline' | 'drift' | 'apply'
  fromVersion: string
  toVersion: string
  summary: string
  status: 'success' | 'error'
  detail: string
  createdAt: string
}

/**
 * Migration 오케스트레이터(§ops-plan Phase 3) — 기존 자산을 엮는 가교.
 *  - Drift[diff②]  : introspect(실제) vs 마지막 스냅샷 → `versions/diff.diffSnapshots` 재사용
 *  - Plan[diff③]   : 타깃 버전 vs 실제 → `ddlDiff.generateMigration` 로 ALTER SQL
 *  - Run           : 생성 SQL 을 2c `query.tx*` 게이트로 실행(파괴적 승인 후 커밋)
 *  - 성공 시        : post-apply 스냅샷 저장 + appliedVersion 갱신 + 로그
 */
interface MigrationState {
  actual: VersionSnapshot | null
  // Drift
  driftDiff: SchemaDiff | null
  hasBaseline: boolean
  baselineVersion: string
  // Plan
  targetVersion: string | null
  planDiff: SchemaDiff | null
  plan: MigrationPlan | null
  destructiveAck: boolean
  // Run (tx 게이트)
  tx: { txId: string; affected: number; statements: number } | null
  logs: MigrationLog[]
  loading: boolean
  error: string | null

  introspectActual: (envId: string, designId: string) => Promise<VersionSnapshot>
  loadDrift: (envId: string, designId: string) => Promise<void>
  captureBaseline: (envId: string, designId: string, version: string) => Promise<void>
  setTarget: (version: string) => void
  setDestructiveAck: (v: boolean) => void
  loadPlan: (envId: string, designId: string, dialect: DialectId, version: string) => Promise<void>
  run: (envId: string) => Promise<void>
  confirm: (envId: string, designId: string) => Promise<void>
  rollback: () => Promise<void>
  loadLogs: (envId: string) => Promise<void>
  dismissError: () => void
  reset: () => void
}

function targetSnapshot(designId: string, version: string): VersionSnapshot | null {
  const list = useVersionsStore.getState().byDesign[designId] ?? []
  return list.find((v) => v.number === version)?.snapshot ?? null
}

export const useMigrationStore = create<MigrationState>()((set, get) => ({
  actual: null,
  driftDiff: null,
  hasBaseline: false,
  baselineVersion: '',
  targetVersion: null,
  planDiff: null,
  plan: null,
  destructiveAck: false,
  tx: null,
  logs: [],
  loading: false,
  error: null,

  introspectActual: async (envId, designId) => {
    const ir = await window.rockury.introspection.run(envId)
    const actual: VersionSnapshot = { tables: normalizeSchema(ir, designId) }
    set({ actual })
    return actual
  },

  loadDrift: async (envId, designId) => {
    set({ loading: true, error: null })
    try {
      const actual = await get().introspectActual(envId, designId)
      const base = await window.rockury.migration.latestSnapshot(envId)
      set({
        hasBaseline: !!base,
        baselineVersion: base?.version ?? '',
        driftDiff: base ? diffSnapshots(base.snapshot as VersionSnapshot, actual) : null,
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  captureBaseline: async (envId, designId, version) => {
    set({ loading: true, error: null })
    try {
      const actual = get().actual ?? (await get().introspectActual(envId, designId))
      await window.rockury.migration.saveSnapshot({ envId, version, snapshot: actual })
      await window.rockury.migration.appendLog({
        envId,
        kind: 'baseline',
        toVersion: version,
        summary: `기준선 캡처 (${actual.tables.length}개 테이블)`
      })
      await get().loadDrift(envId, designId)
      await get().loadLogs(envId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  setTarget: (version) => set({ targetVersion: version, plan: null, planDiff: null }),
  setDestructiveAck: (v) => set({ destructiveAck: v }),

  loadPlan: async (envId, designId, dialect, version) => {
    set({ loading: true, error: null, targetVersion: version })
    try {
      await useVersionsStore.getState().ensureLoaded(designId)
      const target = targetSnapshot(designId, version)
      if (!target) throw new Error(`버전 스냅샷을 찾을 수 없습니다: ${version}`)
      const actual = await get().introspectActual(envId, designId)
      set({
        planDiff: diffSnapshots(actual, target),
        plan: generateMigration(actual, target, dialect),
        destructiveAck: false,
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  run: async (envId) => {
    const plan = get().plan
    if (!plan || plan.statements.length === 0) return
    set({ loading: true, error: null })
    try {
      const { txId } = await window.rockury.query.txBegin(envId)
      let affected = 0
      for (const st of plan.statements) {
        const r = await window.rockury.query.txExec(txId, st.sql)
        affected += r.affectedRows ?? 0
      }
      set({ tx: { txId, affected, statements: plan.statements.length }, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false, tx: null })
    }
  },

  confirm: async (envId, designId) => {
    const { tx, targetVersion, baselineVersion } = get()
    if (!tx || !targetVersion) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      const target = targetSnapshot(designId, targetVersion)
      if (target) await window.rockury.migration.saveSnapshot({ envId, version: targetVersion, snapshot: target })
      await useEnvironmentsStore.getState().setApplied(envId, targetVersion)
      await window.rockury.migration.appendLog({
        envId,
        kind: 'apply',
        fromVersion: baselineVersion,
        toVersion: targetVersion,
        summary: `${tx.statements}개 문 반영 · 영향 ${tx.affected}행`
      })
      set({ tx: null, plan: null, planDiff: null })
      await get().loadLogs(envId)
      await get().loadDrift(envId, designId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), tx: null })
    }
  },

  rollback: async () => {
    const tx = get().tx
    if (!tx) return
    try {
      await window.rockury.query.txRollback(tx.txId)
    } catch {
      // 이미 정리됐을 수 있음
    }
    set({ tx: null })
  },

  loadLogs: async (envId) => {
    try {
      const logs = (await window.rockury.migration.listLogs(envId)) as MigrationLog[]
      set({ logs })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  dismissError: () => set({ error: null }),
  reset: () => set({ actual: null, driftDiff: null, plan: null, planDiff: null, tx: null, targetVersion: null })
}))
