import { create } from 'zustand'
import { errorMessage } from '@shared/errorMessage'
import { useNav } from '@renderer/nav/useNav'
import { normalizeSchema } from '../remote/introspection'
import { scopeModel } from '../scope'
import { alignSnapshotToActual } from '../versions/align'
import { diffSnapshots, isEmptyDiff, type SchemaDiff } from '../versions/diff'
import { useVersionsStore, type VersionSnapshot } from '../versions/store'
import { useDesignsStore } from '../designs/store'
import { restoreDraftFromSnapshot, useDefinitionStore } from '../workspaces/definition/store'
import { useConnectionsStore, type ConnectionDef } from '../connections/store'
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

  /** 이 연결에서 고를 수 있는 스키마. 아직 못 읽었으면 null. */
  availableSchemas: string[] | null
  /** 카탈로그(database) 목록 — PostgreSQL 만 채워진다. */
  catalogs: string[]
  /**
   * 설계 편집본(Draft)까지 실 DB 모습으로 맞출까 — 기존 설계에 버전을 더할 때만 고른다.
   * 켜져 있어야 "가져왔는데 설계 화면은 그대로"가 안 생긴다(새 설계는 늘 채우므로 무관).
   */
  applyToDraft: boolean
  scopeLoading: boolean
  scopeError: string | null

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
  setApplyToDraft: (v: boolean) => void
  /** 고를 수 있는 스키마·카탈로그 목록을 읽는다(prepare 가 나란히 부른다). */
  loadScopeOptions: () => Promise<void>
  /** 읽어올 범위를 바꾼다 — 연결에 저장하고 그 범위로 다시 읽는다. */
  setScope: (schemas: string[]) => void
  /** 다른 카탈로그(database)를 가져온다 — 그 database 에 붙는 연결로 대상을 갈아탄다. */
  switchConnection: (target: ConnectionDef) => void
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
  availableSchemas: null,
  catalogs: [],
  scopeLoading: false,
  scopeError: null,
  applyToDraft: true,
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
      availableSchemas: null,
      catalogs: [],
      scopeError: null,
      applyToDraft: true,
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
    // 다시 시도로도 들어온다 — 읽는 중 표시를 여기서 세운다(직전 실패 문구는 지운다).
    set({ phase: 'preparing', error: null })
    void get().loadScopeOptions()
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
      // 범위는 **명시해서** 넘긴다: 창에서 막 고친 범위를 저장이 끝나기 전에 바로 읽어야 하고,
      // 넘기지 않으면 연결에 저장된 값(비었으면 기본 스키마 하나)만 읽혀 여러 스키마로 짜인
      // 원격이 조각만 들어온다.
      const ir = await window.rockury.introspection.run(connection.id, connection.schemas)
      const actual: VersionSnapshot = { tables: normalizeSchema(ir, design?.id ?? '') }

      set({ phase: 'ready', actual, latestNumber: latest, prevSnapshot })
      // 기본 모드로 파생값(번호·diff) 계산.
      get().chooseMode(get().mode)
    } catch (e) {
      // actual 은 null 로 남는다 → 화면이 "못 읽었다 + 다시 시도"를 그린다(가져오기는 막힌 상태).
      set({ phase: 'ready', error: errorMessage(e, '실 DB 를 읽지 못했습니다.') })
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

  loadScopeOptions: async () => {
    const conn = get().connection
    if (!conn) return
    const model = scopeModel(conn.dbType)
    // SQLite 는 고를 것이 없다 — 목록을 읽지도, 칸을 그리지도 않는다.
    if (!model.selectable) {
      set({ availableSchemas: [], catalogs: [], scopeLoading: false, scopeError: null })
      return
    }
    set({ scopeLoading: true, scopeError: null })
    try {
      const [schemas, catalogs] = await Promise.all([
        window.rockury.introspection.schemas(conn.id),
        model.hasCatalogLayer ? window.rockury.introspection.catalogs(conn.id) : Promise.resolve([])
      ])
      // 늦게 온 답은 버린다 — 읽는 동안 창을 닫거나 다른 database 로 갈아탔을 수 있다.
      if (!get().open || get().connection?.id !== conn.id) return
      set({ availableSchemas: schemas, catalogs, scopeLoading: false })
    } catch (e) {
      if (!get().open || get().connection?.id !== conn.id) return
      // 범위를 못 읽는 것과 실 DB 를 못 읽는 것은 다른 일이다 — 가져오기 자체는 살려 둔다.
      set({ availableSchemas: [], catalogs: [], scopeLoading: false, scopeError: errorMessage(e, '범위를 읽지 못했습니다.') })
    }
  },

  setScope: (schemas) => {
    const conn = get().connection
    if (!conn) return
    // 연결에도 저장한다 — 드리프트 검사(`loadDrift`)와 Remote 화면은 연결에 저장된 범위로 읽는다.
    // 창에서만 들고 있으면 가져온 직후부터 "안 가져온 스키마"가 통째로 드리프트로 잡힌다.
    void useConnectionsStore.getState().setSchemas(conn.id, schemas)
    set({ connection: { ...conn, schemas } })
    void get().prepare()
  },

  switchConnection: (target) => {
    const prev = get().connection
    if (!prev || target.id === prev.id) return
    const { designName } = get()
    set({
      connection: target,
      // 새 설계 이름은 연결 이름에서 나온다 — 사용자가 손대지 않았을 때만 새 연결 이름을 따라간다.
      designName:
        designName === defaultImportDesignName(prev.name) ? defaultImportDesignName(target.name) : designName,
      availableSchemas: null,
      catalogs: [],
      actual: null,
      diff: null,
      error: null
    })
    void get().prepare()
  },

  setDesignName: (v) => set({ designName: v }),
  setNumber: (v) => set({ number: v }),
  setNote: (v) => set({ note: v }),
  setApplyToDraft: (v) => set({ applyToDraft: v }),

  execute: async () => {
    const { connection, design, actual, number, note, designName, mode, applyToDraft } = get()
    const num = number.trim()
    if (!connection || !actual) return
    // 최신 버전과 똑같으면 버전은 안 만든다 — 그래도 설계 반영은 남아 있을 수 있다.
    const noChanges = !!get().hasPrevVersion && !!get().diff && isEmptyDiff(get().diff!)
    const cutVersion = !noChanges
    if (cutVersion && !num) return
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

      // 2b) Draft(Design 편집본) 반영 — **버전만 만들면 설계 화면은 그대로다.**
      //     예전엔 새 설계일 때만 채웠다. 그래서 기존 설계에 버전을 더하면 실 DB 를 40개 읽고도
      //     Design 화면엔 예전 16개가 남아, 사용자 눈에는 "가져왔는데 안 들어왔다"가 됐다
      //     (2026-08-03 실측). 이제 새 설계는 늘, 기존 설계는 고른 대로 반영한다.
      //     Draft 는 전역 tables 테이블(PK=id)에 들어가므로 설계 스코프로 id 를 접두해 충돌을 막는다.
      if (isNew) {
        const draftTables = scopeTableIds(snapshot.tables, designId)
        useDefinitionStore.setState((s) => ({ tables: [...s.tables, ...draftTables] }))
      } else if (applyToDraft) {
        restoreDraftFromSnapshot(designId, snapshot.tables)
      }

      if (cutVersion) {
        // 3) 버전 컷.
        await useVersionsStore.getState().cut({ designId, number: num, note: note.trim(), snapshot })

        // 4) 연결↔설계 결속 + 이 버전을 타깃/적용으로(실 DB 가 이미 그 버전이므로).
        const env = await window.rockury.environments.ensure(connection.id, designId, num)
        await window.rockury.environments.setApplied(env.id, num)

        // 5) 이력에 남긴다 — 이 버전이 어디서 왔는지(실 DB 역설계)는 나중에 되짚을 값이다.
        await window.rockury.migration.appendLog({
          envId: env.id,
          kind: 'map',
          toVersion: num,
          summary: `운영 DB 가져오기 → ${num} (${snapshot.tables.length}개 테이블)`
        })
      }

      // 6) 가져온 설계를 활성으로 → Versions/Design 에서 바로 보인다.
      useNav.getState().setContextValue('design', designId)
      // 7) 진단 갱신 — 방금 들인 버전이 곧 실 DB 라 "설계와 일치"가 된다.
      void useMigrationStore.getState().runDiagnosis(connection.id, designId)

      set({ open: false, phase: 'idle' })
    } catch (e) {
      set({ phase: 'ready', error: errorMessage(e, '가져오기에 실패했습니다.') })
    }
  }
}))
