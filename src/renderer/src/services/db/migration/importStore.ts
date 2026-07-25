import { create } from 'zustand'
import { useNav } from '@renderer/nav/useNav'
import { normalizeSchema } from '../console/introspection'
import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, type SchemaDiff } from '../versions/diff'
import { useVersionsStore, type VersionSnapshot } from '../versions/store'
import { useDesignsStore } from '../designs/store'
import { useDefinitionStore } from '../workspaces/definition/store'
import type { ConnectionDef } from '../connections/store'
import type { DesignDef } from '../designs/store'
import { defaultImportDesignName, planImport, scopeTableIds, type ImportMode } from './importSchema'
import { useMigrationStore } from './store'

/**
 * 운영 DB → 설계 가져오기 오케스트레이터(§IA 운영→설계 관문).
 * Migration 드리프트 뷰에서 열린다. 실 DB 를 역설계해 설계의 새 버전으로 되먹이고,
 * 연결↔설계 결속(Environment)까지 자동으로 세운다.
 *
 *   new-design : 연결에 물린 설계 없음 → 새 Design 생성 + 첫 버전 컷
 *   version-up : 기존 설계에 다음 버전 컷(최신 버전과 diff 미리보기, 무변경이면 차단)
 *
 * 컷한 버전은 실 DB 를 그대로 떠온 것이므로 그 환경의 적용 버전 + 드리프트 기준선으로 함께 세운다.
 */
interface ImportState {
  open: boolean
  connection: ConnectionDef | null
  /** 대상 설계. null 이면 새 설계 부트스트랩. */
  design: DesignDef | null
  phase: 'idle' | 'preparing' | 'ready' | 'running'
  error: string | null

  mode: ImportMode
  /** 활성 설계가 있어 version-up 을 고를 수 있는가(모드 토글 노출 여부). */
  canVersionUp: boolean
  /** 역설계한 실 DB 스냅샷(미리보기·컷 대상). */
  actual: VersionSnapshot | null
  /** 기존 최신 버전 대비 변경(version-up + 이전 버전 존재 시에만). */
  diff: SchemaDiff | null
  hasPrevVersion: boolean
  /** prepare 가 캐시하는 활성 설계 컨텍스트(모드 토글 시 재-introspect 없이 재계산). */
  latestNumber: string | null
  prevSnapshot: VersionSnapshot | null

  // 편집 가능한 폼 필드
  designName: string
  number: string
  note: string

  openImport: (connection: ConnectionDef, design: DesignDef | null) => void
  close: () => void
  prepare: () => Promise<void>
  chooseMode: (mode: ImportMode) => void
  setDesignName: (v: string) => void
  setNumber: (v: string) => void
  setNote: (v: string) => void
  execute: () => Promise<void>
}

export const useImportStore = create<ImportState>()((set, get) => ({
  open: false,
  connection: null,
  design: null,
  phase: 'idle',
  error: null,
  mode: 'new-design',
  canVersionUp: false,
  actual: null,
  diff: null,
  hasPrevVersion: false,
  latestNumber: null,
  prevSnapshot: null,
  designName: '',
  number: '',
  note: '',

  openImport: (connection, design) => {
    set({
      open: true,
      connection,
      design,
      phase: 'preparing',
      error: null,
      actual: null,
      diff: null,
      hasPrevVersion: false,
      latestNumber: null,
      prevSnapshot: null,
      canVersionUp: !!design,
      mode: design ? 'version-up' : 'new-design',
      designName: design ? '' : defaultImportDesignName(connection.name),
      number: '',
      note: ''
    })
    void get().prepare()
  },

  close: () => set({ open: false, phase: 'idle', error: null }),

  prepare: async () => {
    const { connection, design } = get()
    if (!connection) return
    try {
      // 활성 설계의 최신 버전 + 스냅샷 캐시(모드 토글 시 재-introspect 없이 재계산).
      let latest: string | null = null
      let prevSnapshot: VersionSnapshot | null = null
      if (design) {
        await useVersionsStore.getState().ensureLoaded(design.id)
        const top = useVersionsStore.getState().byDesign[design.id]?.[0]
        latest = top?.number ?? null
        prevSnapshot = top?.snapshot ?? null
      }

      // 역설계 — new-design 은 아직 설계 id 가 없어 미리보기용 placeholder('')로 읽는다.
      // 실제 컷 때 execute() 가 생성된 설계 id 로 재-스탬프한다.
      const ir = await window.rockury.introspection.run(connection.id)
      const actual: VersionSnapshot = { tables: normalizeSchema(ir, design?.id ?? '') }

      set({ phase: 'ready', actual, latestNumber: latest, prevSnapshot })
      // 기본 모드로 파생값(번호·diff) 계산.
      get().chooseMode(get().mode)
    } catch (e) {
      set({ phase: 'ready', error: e instanceof Error ? e.message : String(e) })
    }
  },

  chooseMode: (mode) => {
    const { actual, latestNumber, prevSnapshot, connection, designName } = get()
    if (mode === 'new-design') {
      // 새 설계 — 이전 버전과 비교하지 않는다(빈 계보). 첫 버전 번호 제안.
      const plan = planImport({ hasDesign: false, latestVersionNumber: null })
      set({
        mode,
        number: plan.suggestedNumber,
        diff: null,
        hasPrevVersion: false,
        designName: designName || defaultImportDesignName(connection?.name ?? '')
      })
      return
    }
    // version-up — 최신 버전 대비 diff(무변경 차단). 다음 번호 제안.
    // 이전 버전이 설계 저작(순번 id)이어도 이름 정렬로 실DB(이름 id)와 짝을 맞춘다(§경계 정렬).
    const plan = planImport({ hasDesign: true, latestVersionNumber: latestNumber })
    const diff =
      prevSnapshot && actual ? diffSnapshots(alignSnapshotToActual(prevSnapshot, actual), actual) : null
    set({ mode, number: plan.suggestedNumber, diff, hasPrevVersion: !!prevSnapshot })
  },

  setDesignName: (v) => set({ designName: v }),
  setNumber: (v) => set({ number: v }),
  setNote: (v) => set({ note: v }),

  execute: async () => {
    const { connection, design, actual, number, note, designName, mode } = get()
    const num = number.trim()
    if (!connection || !actual || !num) return
    set({ phase: 'running', error: null })
    try {
      // 1) 대상 설계 확보 — new-design 이면 연결 벤더로 새 설계를 만든다.
      let designId: string
      const isNew = mode === 'new-design'
      if (isNew) {
        designId = await useDesignsStore.getState().addDesign({
          name: designName.trim() || defaultImportDesignName(connection.name),
          description: `${connection.name} 에서 가져옴`,
          dialect: connection.dbType
        })
      } else {
        designId = design!.id
      }

      // 2) 스냅샷의 소속 설계 id 확정(new-design 은 placeholder 였음).
      //    버전 스냅샷은 이름 기반 id 를 유지한다 — 이후 version-up 역설계와 안정적으로 매칭되도록.
      const snapshot: VersionSnapshot = {
        tables: actual.tables.map((t) => (t.designId === designId ? t : { ...t, designId }))
      }

      // 2b) 새 설계면 Draft(Studio 편집본)도 채운다 — 안 그러면 Studio 가 빈 껍데기.
      //     Draft 는 전역 tables 테이블(PK=id)에 들어가므로 설계 스코프로 id 를 접두해 충돌을 막는다.
      if (isNew) {
        const draftTables = scopeTableIds(snapshot.tables, designId)
        useDefinitionStore.setState((s) => ({ tables: [...s.tables, ...draftTables] }))
      }

      // 3) 버전 컷.
      await useVersionsStore.getState().cut({ designId, number: num, note: note.trim(), snapshot })

      // 4) 연결↔설계 결속 + 이 버전을 타깃/적용으로(실 DB 가 이미 그 버전이므로).
      const env = await window.rockury.environments.ensure(connection.id, designId, num)
      await window.rockury.environments.setApplied(env.id, num)

      // 5) 드리프트 기준선 스냅샷 + 로그(이후 드리프트 비교의 기준).
      await window.rockury.migration.saveSnapshot({ envId: env.id, version: num, snapshot })
      await window.rockury.migration.appendLog({
        envId: env.id,
        kind: 'baseline',
        toVersion: num,
        summary: `운영 DB 가져오기 → ${num} (${snapshot.tables.length}개 테이블)`
      })

      // 6) 가져온 설계를 활성으로 → Versions/Studio 에서 바로 보인다.
      useNav.getState().setContextValue('design', designId)
      // 7) 드리프트 뷰 갱신(기준선 == 실제 → 드리프트 0 으로 정합).
      void useMigrationStore.getState().loadDrift(connection.id, designId)

      set({ open: false, phase: 'idle' })
    } catch (e) {
      set({ phase: 'ready', error: e instanceof Error ? e.message : String(e) })
    }
  }
}))
