import { create } from 'zustand'
import type { DialectId } from '../dialects'
import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, type SchemaDiff } from '../versions/diff'
import { useVersionsStore, type VersionSnapshot } from '../versions/store'
import { normalizeSchema } from '../console/introspection'
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

interface Binding {
  id: string
  targetVersion: string
  appliedVersion: string | null
}

/**
 * Migration 오케스트레이터(§ops-plan Phase 3 · IA 결정 B) — Connection + Design 을 엮는 가교.
 * (connection × design) 바인딩(Environment)을 확보해 그 id 로 스냅샷/로그/appliedVersion 을 관리.
 *  - Drift[diff②]  : introspect(connection) vs 마지막 스냅샷 → diffSnapshots 재사용
 *  - Plan[diff③]   : 타깃 버전 vs 실제 → ddlDiff.generateMigration
 *  - Run           : 생성 SQL 을 2c query.tx* 게이트로 실행 → 커밋 시 스냅샷/appliedVersion/로그
 */
interface MigrationState {
  binding: Binding | null
  actual: VersionSnapshot | null
  driftDiff: SchemaDiff | null
  hasBaseline: boolean
  baselineVersion: string
  targetVersion: string | null
  planDiff: SchemaDiff | null
  plan: MigrationPlan | null
  destructiveAck: boolean
  tx: { txId: string; affected: number; statements: number } | null
  logs: MigrationLog[]
  loading: boolean
  error: string | null

  resolveBinding: (connectionId: string, designId: string, targetVersion?: string) => Promise<Binding>
  introspectActual: (connectionId: string, designId: string) => Promise<VersionSnapshot>
  loadDrift: (connectionId: string, designId: string) => Promise<void>
  captureBaseline: (connectionId: string, designId: string, version: string) => Promise<void>
  setDestructiveAck: (v: boolean) => void
  loadPlan: (connectionId: string, designId: string, dialect: DialectId, version: string) => Promise<void>
  run: (connectionId: string) => Promise<void>
  confirm: (connectionId: string, designId: string) => Promise<void>
  rollback: () => Promise<void>
  loadLogs: (connectionId: string, designId: string) => Promise<void>
  dismissError: () => void
}

function targetSnapshot(designId: string, version: string): VersionSnapshot | null {
  const list = useVersionsStore.getState().byDesign[designId] ?? []
  return list.find((v) => v.number === version)?.snapshot ?? null
}

export const useMigrationStore = create<MigrationState>()((set, get) => ({
  binding: null,
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

  resolveBinding: async (connectionId, designId, targetVersion = '') => {
    const rec = await window.rockury.environments.ensure(connectionId, designId, targetVersion)
    const binding: Binding = {
      id: rec.id,
      targetVersion: rec.targetVersion,
      appliedVersion: rec.appliedVersion
    }
    set({ binding })
    return binding
  },

  introspectActual: async (connectionId, designId) => {
    const ir = await window.rockury.introspection.run(connectionId)
    const actual: VersionSnapshot = { tables: normalizeSchema(ir, designId) }
    set({ actual })
    return actual
  },

  loadDrift: async (connectionId, designId) => {
    set({ loading: true, error: null })
    try {
      const binding = await get().resolveBinding(connectionId, designId)
      const actual = await get().introspectActual(connectionId, designId)
      const base = await window.rockury.migration.latestSnapshot(binding.id)
      set({
        hasBaseline: !!base,
        baselineVersion: base?.version ?? '',
        // 기준선이 설계 저작 스냅샷(순번 id)일 수 있어 이름 정렬 후 비교(§경계 정렬).
        driftDiff: base
          ? diffSnapshots(alignSnapshotToActual(base.snapshot as VersionSnapshot, actual), actual)
          : null,
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  captureBaseline: async (connectionId, designId, version) => {
    set({ loading: true, error: null })
    try {
      const binding = await get().resolveBinding(connectionId, designId)
      const actual = get().actual ?? (await get().introspectActual(connectionId, designId))
      await window.rockury.migration.saveSnapshot({ envId: binding.id, version, snapshot: actual })
      await window.rockury.migration.appendLog({
        envId: binding.id,
        kind: 'baseline',
        toVersion: version,
        summary: `기준선 캡처 (${actual.tables.length}개 테이블)`
      })
      await get().loadDrift(connectionId, designId)
      await get().loadLogs(connectionId, designId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  setDestructiveAck: (v) => set({ destructiveAck: v }),

  loadPlan: async (connectionId, designId, dialect, version) => {
    set({ loading: true, error: null, targetVersion: version })
    try {
      await useVersionsStore.getState().ensureLoaded(designId)
      const target = targetSnapshot(designId, version)
      if (!target) throw new Error(`버전 스냅샷을 찾을 수 없습니다: ${version}`)
      await get().resolveBinding(connectionId, designId, version)
      const actual = await get().introspectActual(connectionId, designId)
      // 설계 저작 버전(순번 id)↔실DB(이름 id) 비교 — 이름 정렬 없이는 "전부 DROP+CREATE"로 오판(§경계 정렬).
      const alignedTarget = alignSnapshotToActual(target, actual)
      set({
        planDiff: diffSnapshots(actual, alignedTarget),
        plan: generateMigration(actual, alignedTarget, dialect),
        destructiveAck: false,
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  run: async (connectionId) => {
    const plan = get().plan
    if (!plan || plan.statements.length === 0) return
    set({ loading: true, error: null })
    try {
      const { txId } = await window.rockury.query.txBegin(connectionId)
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

  confirm: async (connectionId, designId) => {
    const { tx, targetVersion, baselineVersion, binding } = get()
    if (!tx || !targetVersion || !binding) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      const target = targetSnapshot(designId, targetVersion)
      if (target) await window.rockury.migration.saveSnapshot({ envId: binding.id, version: targetVersion, snapshot: target })
      await window.rockury.environments.setApplied(binding.id, targetVersion)
      await window.rockury.migration.appendLog({
        envId: binding.id,
        kind: 'apply',
        fromVersion: baselineVersion,
        toVersion: targetVersion,
        summary: `${tx.statements}개 문 반영 · 영향 ${tx.affected}행`
      })
      set({ tx: null, plan: null, planDiff: null })
      await get().loadLogs(connectionId, designId)
      await get().loadDrift(connectionId, designId)
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

  loadLogs: async (connectionId, designId) => {
    try {
      const binding = get().binding ?? (await get().resolveBinding(connectionId, designId))
      const logs = (await window.rockury.migration.listLogs(binding.id)) as MigrationLog[]
      set({ logs })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  dismissError: () => set({ error: null })
}))
