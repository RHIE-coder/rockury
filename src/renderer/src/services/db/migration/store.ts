import { create } from 'zustand'
import type { DialectId } from '../dialects'
import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, type SchemaDiff } from '../versions/diff'
import { useVersionsStore, type VersionSnapshot } from '../versions/store'
import { normalizeSchema } from '../remote/introspection'
import { diagnose, pickTargetVersion, type Diagnosis } from './diagnose'
import { identifyVersion, type IdentifyResult } from './identify'
import { removalSignature } from './planGate'
import { generateRevert, type RevertPlan } from './revert'
import { generateMigration, type MigrationPlan } from './ddlDiff'

/** migration_logs 레코드(구조적 — main/store/migration 과 동일). */
export interface MigrationLog {
  id: string
  envId: string
  kind: 'apply' | 'map'
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
 * Migration 오케스트레이터 — Connection 과 Design 을 하나의 흐름으로 엮는다.
 *
 * 화면이 읽는 상태는 결국 **한 줄**이다: `Design vX ── Remote vY`.
 * 나머지는 그 줄에서 갈라지는 것들이다.
 *
 *   맵핑 : 이 연결은 어느 설계의 몇 버전인가        → identify → confirmMapping
 *   진단 : 둘 사이에 무엇이 있나(두 갈래)           → runDiagnosis
 *   계획 : 그 차이를 메울 SQL 과 되돌릴 SQL          → loadPlan
 *   실행 : 트랜잭션으로 밀고 커밋/되돌리기           → run → confirm
 *
 * **Remote 버전의 지상 진실은 우리 로컬 기록**(`environments.applied_version`)이다.
 * 실 DB 에는 버전이라는 것이 없으므로 DB 에서 읽지 않는다.
 */
interface MigrationState {
  binding: Binding | null
  actual: VersionSnapshot | null
  /** 방금 역설계가 **실제로 읽은** 스키마 범위(응답이 알려 준다). 스냅샷에 적히는 값. */
  actualScope: string[]

  // ── 맵핑 ─────────────────────────────────────────────
  /** Remote 가 지금 어느 설계 버전인가. 빈 문자열이면 아직 맵핑 안 됨. */
  remoteVersion: string
  /** 맵핑 화면이 쓰는 자동 판정 결과. 맵핑된 짝에서는 null. */
  identified: IdentifyResult | null

  // ── 진단 ─────────────────────────────────────────────
  diagnosis: Diagnosis | null
  /**
   * 진단 화면이 그리는 대조표의 **설계 쪽**(지금 실제에 맞춰 정렬한 타깃 스냅샷).
   *
   * 계획의 `planTarget` 과 값은 같지만 만드는 시점이 다르다 — 진단은 SQL 을 뽑지 않고도
   * "지금 DB 와 설계가 어떻게 다른가"를 표로 보여야 해서, 진단이 스스로 든다.
   */
  diagTarget: VersionSnapshot | null
  /** 그 대조의 숫자 요약(제목 옆 눈금). 실제 → 타깃. */
  diagDiff: SchemaDiff | null
  targetVersion: string | null

  // ── 계획·실행 ────────────────────────────────────────
  planDiff: SchemaDiff | null
  plan: MigrationPlan | null
  /** 반영 뒤가 될 모습(경계 정렬을 마친 타깃) — 대조표가 "지금 → 반영 뒤"를 그리는 데 쓴다. */
  planTarget: VersionSnapshot | null
  revert: RevertPlan | null
  destructiveAck: boolean
  /**
   * 진단을 거쳐 계획으로 넘어왔다는 표식 — 그때 본 **없앨 것들의 목록**(`removalSignature`)을 든다.
   * 계획 화면이 이 값으로 관문을 연다(`planGate`). 목록을 드는 이유는 그 사이 지울 것이 달라지면
   * 승인이 저절로 풀려야 하기 때문이다.
   */
  removalsPassed: string | null
  tx: { txId: string; affected: number; statements: number } | null
  /** 남이 먼저 바꿔서 멈춘 자리. `at` 은 실행한 문 수(0 이면 아무것도 안 나갔다). */
  interrupted: { at: number; total: number; detail: string } | null

  logs: MigrationLog[]
  loading: boolean
  error: string | null

  resolveBinding: (connectionId: string, designId: string, targetVersion?: string) => Promise<Binding>
  introspectActual: (connectionId: string, designId: string) => Promise<VersionSnapshot>
  identify: (connectionId: string, designId: string) => Promise<void>
  confirmMapping: (connectionId: string, designId: string, version: string) => Promise<void>
  runDiagnosis: (connectionId: string, designId: string, target?: string) => Promise<void>
  setDestructiveAck: (v: boolean) => void
  passRemovals: () => void
  loadPlan: (connectionId: string, designId: string, dialect: DialectId, version: string) => Promise<void>
  run: (connectionId: string, designId: string) => Promise<void>
  confirm: (connectionId: string, designId: string) => Promise<void>
  rollback: () => Promise<void>
  loadLogs: (connectionId: string, designId: string) => Promise<void>
  dismissError: () => void
}

function versionsOf(designId: string): { number: string; snapshot: VersionSnapshot }[] {
  return (useVersionsStore.getState().byDesign[designId] ?? []).map((v) => ({
    number: v.number,
    snapshot: v.snapshot
  }))
}

function snapshotAt(designId: string, version: string): VersionSnapshot | null {
  return versionsOf(designId).find((v) => v.number === version)?.snapshot ?? null
}

/**
 * 이 설계의 버전 번호들 — **최신순**이다(저장소가 `created_at DESC` 로 준다). 맨 앞이 최신.
 *
 * 예전엔 맨 뒤를 집어, 버전이 둘 이상인 설계에서 타깃이 늘 **맨 처음 컷한 버전**으로 잡혔다.
 * 화면은 "최신으로 간다"고 적어 두고 실제로는 가장 낡은 것을 골랐다
 * (2026-08-12 e2e 로 드러남 — 진단이 "설계와 같다"고 우겼다). 순서를 여기서 지킨다.
 */
function versionNumbers(designId: string): string[] {
  return (useVersionsStore.getState().byDesign[designId] ?? []).map((v) => v.number)
}

/** 실 DB 의 모양을 한 문자열로 — 실행 도중 남이 바꿨는지 견주는 데 쓴다. */
function fingerprint(s: VersionSnapshot): string {
  return JSON.stringify(
    [...s.tables]
      .map((t) => [
        t.schema ?? '',
        t.name,
        [...t.columns].map((c) => `${c.name}:${c.type}:${c.nullable}`).sort(),
        [...t.constraints].map((k) => `${k.kind}:${k.name}`).sort()
      ])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  )
}

export const useMigrationStore = create<MigrationState>()((set, get) => ({
  binding: null,
  actual: null,
  actualScope: [],
  remoteVersion: '',
  identified: null,
  diagnosis: null,
  diagTarget: null,
  diagDiff: null,
  targetVersion: null,
  planDiff: null,
  plan: null,
  planTarget: null,
  revert: null,
  destructiveAck: false,
  removalsPassed: null,
  tx: null,
  interrupted: null,
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
    /*
     * 연결↔설계 짝이 바뀌면 앞선 승인도 계획도 **다른 DB 에 대한 것**이라 버린다.
     * 승인만 풀던 동안은 남은 계획이 그대로 서서, 실행 화면이 앞 연결의 문 여든네 개를
     * 새 연결에 밀 수 있게 내밀었다(§run 은 화면이 준 연결 id 로 나간다).
     */
    const stale = get().binding && get().binding!.id !== rec.id
    set({
      binding,
      remoteVersion: rec.appliedVersion ?? '',
      ...(stale
        ? {
            removalsPassed: null,
            plan: null,
            planDiff: null,
            planTarget: null,
            revert: null,
            destructiveAck: false,
            interrupted: null
          }
        : {})
    })
    return binding
  },

  introspectActual: async (connectionId, designId) => {
    const ir = await window.rockury.introspection.run(connectionId)
    const actual: VersionSnapshot = { tables: normalizeSchema(ir, designId) }
    // 연결 설정이 아니라 **실제로 읽은 범위**를 든다 — 설정은 그 사이 바뀌었을 수 있고,
    // 스냅샷에 적어야 할 사실은 "이 스냅샷이 어디를 본 것인가"다.
    set({ actual, actualScope: ir.schemas ?? [] })
    return actual
  },

  /**
   * 맵핑 판정 — 실 DB 를 떠서 설계의 모든 버전과 대조한다. **아무것도 만들지 않는다.**
   * 만드는 것은 confirmMapping(못박기)과 가져오기(새 버전)의 몫이다.
   */
  identify: async (connectionId, designId) => {
    set({ loading: true, error: null })
    try {
      await useVersionsStore.getState().ensureLoaded(designId)
      await get().resolveBinding(connectionId, designId)
      const actual = await get().introspectActual(connectionId, designId)
      set({ identified: identifyVersion(actual, versionsOf(designId)), loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  /**
   * 판정을 확정한다 — "이 실 DB 는 v0.1.0 이다"를 못박는다.
   *
   * 이력에 한 줄을 남기는 이유: 이 순간이 그 연결의 출발점이라, 뒤에 쌓일 반영들이
   * 어디서부터 시작했는지 되짚을 수 있어야 한다.
   */
  confirmMapping: async (connectionId, designId, version) => {
    set({ loading: true, error: null })
    try {
      const binding = await get().resolveBinding(connectionId, designId)
      const actual = get().actual ?? (await get().introspectActual(connectionId, designId))
      await window.rockury.environments.setApplied(binding.id, version)
      await window.rockury.migration.appendLog({
        envId: binding.id,
        kind: 'map',
        toVersion: version,
        summary: `맵핑 확정 — 이 연결은 ${version} 입니다 (${actual.tables.length}개 테이블)`
      })
      set({ identified: null })
      await get().runDiagnosis(connectionId, designId)
      await get().loadLogs(connectionId, designId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  /**
   * 진단 — 상태 줄(`Design vX ── Remote vY`)과 지금 DB ↔ 설계의 차이를 채운다.
   * 계획을 만들지는 않는다(그건 실 DB 에 나갈 SQL 이라 따로 뽑는다).
   */
  runDiagnosis: async (connectionId, designId, target) => {
    set({ loading: true, error: null })
    try {
      await useVersionsStore.getState().ensureLoaded(designId)
      const binding = await get().resolveBinding(connectionId, designId)
      const actual = await get().introspectActual(connectionId, designId)
      const remoteVersion = binding.appliedVersion ?? ''
      const targetVersion = pickTargetVersion({
        explicit: target,
        remembered: get().targetVersion,
        versions: versionNumbers(designId)
      })
      const atTarget = targetVersion ? snapshotAt(designId, targetVersion) : null
      // 진단 화면의 대조표가 그릴 "설계 쪽" — 계획과 **같은 정렬**을 거친다(§경계 정렬).
      // 정렬을 건너뛰면 id 스킴이 달라 전부 DROP+CREATE 로 보인다. 표 하나에 39개 테이블이
      // 걸리므로 한 번만 돌린다.
      const diagTarget = atTarget ? alignSnapshotToActual(atTarget, actual) : null

      set({
        remoteVersion,
        targetVersion,
        diagTarget,
        diagDiff: diagTarget ? diffSnapshots(actual, diagTarget) : null,
        diagnosis: diagnose({
          atRemote: remoteVersion ? snapshotAt(designId, remoteVersion) : null,
          atTarget
        }),
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  setDestructiveAck: (v) => set({ destructiveAck: v }),
  /** 지금 계획이 없앨 것을 알고 간다 — 진단 화면의 "설계 → 실제"가 부른다(§planGate). */
  passRemovals: () => {
    const diff = get().diagDiff
    set({ removalsPassed: diff ? removalSignature(diff) : null })
  },

  loadPlan: async (connectionId, designId, dialect, version) => {
    set({ loading: true, error: null, targetVersion: version })
    try {
      await useVersionsStore.getState().ensureLoaded(designId)
      const target = snapshotAt(designId, version)
      if (!target) throw new Error(`버전 스냅샷을 찾을 수 없습니다: ${version}`)
      await get().resolveBinding(connectionId, designId, version)
      // 진단을 먼저 새로 돌린다 — 계획을 여는 사람이 진단을 거쳤으리라 기대할 수 없다.
      await get().runDiagnosis(connectionId, designId, version)
      const actual = get().actual
      if (!actual) throw new Error('실제 스키마를 읽지 못했습니다')

      // 설계 저작 버전(순번 id)↔실DB(이름 id) 비교 — 이름 정렬 없이는 "전부 DROP+CREATE"로 오판(§경계 정렬).
      const alignedTarget = alignSnapshotToActual(target, actual)
      set({
        planDiff: diffSnapshots(actual, alignedTarget),
        planTarget: alignedTarget,
        plan: generateMigration(actual, alignedTarget, dialect),
        // 되돌리기는 "지금 실제로" 돌아가는 것 — 반영 뒤 물릴 때 도착지가 여기다.
        revert: generateRevert(actual, alignedTarget, dialect),
        destructiveAck: false, // 계획이 바뀌면 앞선 승인은 무효 — 다른 계획에 대한 동의였다.
        interrupted: null,
        loading: false
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  /**
   * 반영 — 밀기 직전에 실 DB 를 **다시 읽어** 계획을 세운 뒤로 남이 바꿨는지 본다.
   *
   * 왜 하필 여기서 보나: 계획을 만든 순간과 실행 버튼을 누르는 순간 사이가 제일 긴 틈이다
   * (사람이 SQL 을 읽어 보는 시간). 그 사이에 누가 DB 를 고치면 계획은 이미 낡은 것이 되고,
   * 낡은 계획은 남의 변경을 DROP 으로 지운다.
   *
   * **한계를 정직하게:** 문과 문 **사이**는 보지 않는다. 볼 수는 있지만 확인 한 번이 실 DB 를
   * 통째로 다시 읽는 일이라, 문 스무 개짜리 계획에 수십 초가 붙는다. 그 틈은 밀리초 단위라
   * 위험이 훨씬 작아 값을 치를 만하지 않다고 봤다 — 이건 기술 제약이 아니라 **선택**이다.
   * 실행 중 문이 실패하면 그 자리에서 멈추고, 화면이 되돌리기 SQL 을 내민다.
   */
  run: async (connectionId, designId) => {
    const { plan, actual } = get()
    if (!plan || plan.statements.length === 0) return
    set({ loading: true, error: null, interrupted: null })
    try {
      const fresh = await get().introspectActual(connectionId, designId)
      if (actual && fingerprint(actual) !== fingerprint(fresh)) {
        set({
          loading: false,
          plan: null,
          revert: null,
          planDiff: null,
          planTarget: null,
          interrupted: {
            at: 0,
            total: plan.statements.length,
            detail: '계획을 세운 뒤 실 DB 가 바뀌었습니다 — 아무것도 실행하지 않았습니다.'
          }
        })
        return
      }

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
    const { tx, targetVersion, remoteVersion, binding } = get()
    if (!tx || !targetVersion || !binding) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      await window.rockury.environments.setApplied(binding.id, targetVersion)
      await window.rockury.migration.appendLog({
        envId: binding.id,
        kind: 'apply',
        fromVersion: remoteVersion,
        toVersion: targetVersion,
        summary: `${tx.statements}개 문 반영 · 영향 ${tx.affected}행`
      })
      set({ tx: null, plan: null, planDiff: null, planTarget: null, revert: null, interrupted: null })
      await get().loadLogs(connectionId, designId)
      await get().runDiagnosis(connectionId, designId)
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
    set({ tx: null, interrupted: null })
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
