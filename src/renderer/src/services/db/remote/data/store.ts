import { create } from 'zustand'
import type { TableDef } from '../../workspaces/definition/types'
import { qualifiedName, type TableRef } from '../../schemaRef'
import type { DialectId } from '../../dialects'
import {
  buildCount,
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  pkColumns,
  type Filter,
  type Statement
} from './sqlBuilder'
import { genUuid } from './genValue'
import { displayColumns } from './displayColumns'

/**
 * Data 브라우저 스토어(§ops-plan Phase 2b) — 선택 테이블 행 조회 + pending 편집 버퍼.
 * 커밋은 2c 의 트랜잭션 게이트(txBegin→txExecParams→commit/rollback)를 **파라미터 바인드**로 재사용.
 * PK 없으면 편집 불가(sqlBuilder.canEdit) — 커밋 문 생성 자체가 PK 를 요구한다.
 */
export const PAGE_SIZE = 50
export const PAGE_SIZES = [25, 50, 100, 200] as const
export type SortState = { column: string; direction: 'ASC' | 'DESC' } | null

/**
 * 표 하나를 보던 상태(§db-remote.data.filter AC-2) — 표를 옮겼다 돌아오면 그대로 되살린다.
 *
 * 예전엔 표를 고를 때마다 조건을 비웠는데, 정작 화면의 필터 바는 자기 안에 초안을 들고
 * 다시 만들어지지 않아 **적용도 안 한 남의 표 조건**이 떠 있었다("어떻게 공통의 필터값이
 * 생길 수 있냐" — 2026-08-07). 기억할 곳을 여기 한 군데로 모아 그 어긋남을 없앤다.
 */
export interface TableView {
  filters: Filter[]
  /** 조건을 지우지 않고 잠시 안 거는 스위치(§AC-3). */
  filtersEnabled: boolean
  page: number
  orderBy: SortState
}

const DEFAULT_VIEW: TableView = { filters: [], filtersEnabled: true, page: 0, orderBy: null }

/** 표별 기억의 열쇠 — 이름만 쓰면 스키마가 둘 이상 켜졌을 때 동명 표끼리 섞인다(§db/schemaRef). */
export const viewKey = (t: TableRef): string => qualifiedName(t)

/** 행 식별 키 — PK 컬럼 값들의 직렬화(원본 행 기준). */
export function rowKey(pkCols: string[], row: Record<string, unknown>): string {
  return JSON.stringify(pkCols.map((c) => row[c] ?? null))
}

interface NewRow {
  tempId: string
  values: Record<string, unknown>
}

interface DataState {
  /**
   * 지금 고른 테이블 — **이름만으로는 못 가린다.** 범위(scope)에 스키마가 둘 이상 켜져 있으면
   * 같은 이름 테이블이 여럿 올라오고(`service1.customers` · `service2.customers`),
   * 이름으로 되찾으면 목록의 첫 번째가 잡혀 **엉뚱한 표의 행을 보여 준다**(§db/schemaRef).
   */
  table: TableRef | null
  columns: string[]
  rows: Record<string, unknown>[]
  pageSize: number
  loading: boolean
  error: string | null

  // 지금 보고 있는 표의 보기 상태. `views` 에 든 것과 늘 같다(`patchView` 한 곳에서만 쓴다).
  page: number
  orderBy: SortState
  filters: Filter[]
  filtersEnabled: boolean
  /** 표별 기억(§AC-2) — 세션 동안만이다. 앱을 넘는 영속은 저장 필터가 맡는다(§AC-2a). */
  views: Record<string, TableView>

  /** 조건에 맞는 전체 행 수. `null` 은 **모름**(아직 안 셌거나 셈이 실패). */
  total: number | null
  counting: boolean
  /** 셈 요청 일련번호 — 늦게 온 결과가 최신 화면을 덮지 않게 한다(§AC-5). */
  countSeq: number
  /**
   * 조회 요청 일련번호 — 셈과 같은 이유로 행 조회에도 필요하다.
   *
   * 표 A 를 고른 직후 B 를 고르면 A 의 응답이 나중에 도착해 **B 헤더 밑에 A 행**이 박힌다.
   * 없는 키로 값을 꺼내니 칸마다 `undefined` 가 찍힌다 — 표를 고를 때 행을 비우는 것만으로는
   * 안 막히는 두 번째 갈래다(§data.grid AC-8c).
   */
  loadSeq: number

  // pending 편집 버퍼
  edits: Record<string, Record<string, unknown>>
  deletes: Record<string, true>
  inserts: NewRow[]

  // 트랜잭션 게이트
  tx: { txId: string; affected: number; statements: number } | null

  /**
   * 보기 상태를 고친다 — **지금 보는 값과 표별 기억을 한 번에** 쓰는 유일한 통로.
   * 두 자리를 따로 고칠 수 있게 두면 언젠가 한쪽만 고쳐져 예전의 어긋남이 되돌아온다.
   */
  patchView: (patch: Partial<TableView>) => void
  selectTable: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  load: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  /** 행 수를 따로 센다 — 행 조회를 막지 않는다(§AC-4). */
  countRows: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  /** 도착한 셈 결과를 반영한다. 일련번호가 최신이 아니면 버린다(§AC-5). */
  applyCount: (seq: number, total: number | null) => void
  setPage: (envId: string, dialect: DialectId, tableDef: TableDef, page: number) => Promise<void>
  setPageSize: (envId: string, dialect: DialectId, tableDef: TableDef, size: number) => Promise<void>
  toggleSort: (envId: string, dialect: DialectId, tableDef: TableDef, column: string) => Promise<void>
  setFilters: (envId: string, dialect: DialectId, tableDef: TableDef, filters: Filter[]) => Promise<void>
  /** 조건은 그대로 두고 적용만 켜고 끈다(§AC-3). */
  setFiltersEnabled: (
    envId: string,
    dialect: DialectId,
    tableDef: TableDef,
    enabled: boolean
  ) => Promise<void>

  editCell: (key: string, col: string, value: unknown) => void
  resetCell: (key: string, col: string) => void
  toggleDelete: (key: string) => void
  addRow: () => void
  editInsert: (tempId: string, col: string, value: unknown) => void
  removeInsert: (tempId: string) => void
  discard: () => void
  pendingCount: () => number

  buildStatements: (dialect: DialectId, tableDef: TableDef) => Statement[]
  save: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  confirm: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  rollback: () => Promise<void>
  dismissError: () => void
}

const clearPending = (): Pick<DataState, 'edits' | 'deletes' | 'inserts' | 'tx'> => ({
  edits: {},
  deletes: {},
  inserts: [],
  tx: null
})

export const useDataStore = create<DataState>()((set, get) => ({
  table: null,
  columns: [],
  rows: [],
  pageSize: PAGE_SIZE,
  loading: false,
  error: null,
  page: 0,
  orderBy: null,
  filters: [],
  filtersEnabled: true,
  views: {},
  total: null,
  counting: false,
  countSeq: 0,
  loadSeq: 0,
  edits: {},
  deletes: {},
  inserts: [],
  tx: null,

  patchView: (patch) => {
    const s = get()
    const next: TableView = {
      filters: patch.filters ?? s.filters,
      filtersEnabled: patch.filtersEnabled ?? s.filtersEnabled,
      page: patch.page ?? s.page,
      orderBy: patch.orderBy !== undefined ? patch.orderBy : s.orderBy
    }
    // 지금 보는 값과 표별 기억을 **한 번에** 쓴다 — 두 자리를 따로 고치면 언젠가 어긋난다.
    set({
      ...next,
      views: s.table ? { ...s.views, [viewKey(s.table)]: next } : s.views
    })
  },

  selectTable: async (envId, dialect, tableDef) => {
    // 커밋 대기 중인 트랜잭션이 열려 있으면 먼저 롤백한다 — 안 그러면 main 세션이 락을 문 채 방치된다(고아 tx).
    const openTx = get().tx
    if (openTx) {
      try {
        await window.rockury.query.txRollback(openTx.txId)
      } catch {
        // 이미 정리됐을 수 있음
      }
    }
    const table: TableRef = { schema: tableDef.schema, name: tableDef.name }
    // 이 표를 보던 상태를 되살린다(§AC-2). 처음 여는 표면 빈 상태.
    const saved = get().views[viewKey(table)] ?? DEFAULT_VIEW
    // 옛 표의 행·오류는 그 자리에서 버린다 — 헤더는 새 표(역설계)에서 곧장 오는데 행만 옛것이면
    // 불러오는 동안 없는 키로 값을 꺼내 편집 칸마다 "undefined" 가 찍힌다(2026-08-08 제보).
    set({ table, ...saved, rows: [], columns: [], total: null, error: null, ...clearPending() })
    await Promise.all([
      get().load(envId, dialect, tableDef),
      get().countRows(envId, dialect, tableDef)
    ])
  },

  load: async (envId, dialect, tableDef) => {
    const seq = get().loadSeq + 1
    set({ loadSeq: seq, loading: true, error: null })
    try {
      const { pageSize, page, orderBy, filters, filtersEnabled } = get()
      const { sql, params } = buildSelect(dialect, tableDef, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: orderBy ?? undefined,
        filters: filtersEnabled ? filters : []
      })
      const r = await window.rockury.query.runParams(envId, sql, params)
      // 늦게 온 조회는 버린다 — 그 사이 다른 표·조건으로 옮겼으면 이 행들은 남의 것이다.
      if (seq !== get().loadSeq) return
      // 역설계 순서를 우선하되 실제 결과와 맞춘다 — 밖에서 스키마가 바뀌면 헤더와 행의 키가
      // 어긋나 모든 칸이 undefined 로 보인다(displayColumns 주석 참고).
      const columns = displayColumns(
        tableDef.columns.map((c) => c.name),
        r.columns
      )
      set({ rows: r.rows, columns, loading: false })
    } catch (e) {
      if (seq !== get().loadSeq) return // 늦게 온 실패도 마찬가지 — 남의 오류를 띄우지 않는다
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  countRows: async (envId, dialect, tableDef) => {
    const seq = get().countSeq + 1
    set({ countSeq: seq, counting: true })
    const { filters, filtersEnabled } = get()
    const { sql, params } = buildCount(dialect, tableDef, filtersEnabled ? filters : [])
    try {
      const r = await window.rockury.query.runParams(envId, sql, params)
      const first = r.rows[0] as Record<string, unknown> | undefined
      // 방언마다 별칭 대소문자가 다를 수 있어 첫 칸 값을 그대로 읽는다.
      const raw = first ? (first.total ?? Object.values(first)[0]) : null
      const n = Number(raw)
      get().applyCount(seq, Number.isFinite(n) ? n : null)
    } catch {
      // 셈이 실패해도 목록은 이미 떠 있다 — 총 쪽수만 "모름"으로 두고 오류 띠는 안 띄운다(§AC-4).
      get().applyCount(seq, null)
    }
  },

  applyCount: (seq, total) => {
    // 늦게 온 결과는 버린다 — 조건을 빠르게 바꾸면 옛 셈이 나중에 도착한다(§AC-5).
    if (seq !== get().countSeq) return
    set({ total, counting: false })
  },

  setPage: async (envId, dialect, tableDef, page) => {
    // 쪽만 옮기는 것은 전체 행 수를 안 바꾼다 — 다시 세지 않는다.
    get().patchView({ page: Math.max(0, page) })
    await get().load(envId, dialect, tableDef)
  },

  setPageSize: async (envId, dialect, tableDef, size) => {
    // 총 쪽수는 `전체 행 수 ÷ 쪽 크기` 로 화면이 계산한다 — 행 수 자체는 그대로라 다시 안 센다.
    set({ pageSize: size })
    get().patchView({ page: 0 })
    await get().load(envId, dialect, tableDef)
  },

  toggleSort: async (envId, dialect, tableDef, column) => {
    const cur = get().orderBy
    const next: SortState =
      !cur || cur.column !== column
        ? { column, direction: 'ASC' }
        : cur.direction === 'ASC'
          ? { column, direction: 'DESC' }
          : null
    get().patchView({ orderBy: next, page: 0 })
    await get().load(envId, dialect, tableDef)
  },

  setFilters: async (envId, dialect, tableDef, filters) => {
    get().patchView({ filters, page: 0 })
    await Promise.all([
      get().load(envId, dialect, tableDef),
      get().countRows(envId, dialect, tableDef)
    ])
  },

  setFiltersEnabled: async (envId, dialect, tableDef, enabled) => {
    get().patchView({ filtersEnabled: enabled, page: 0 })
    await Promise.all([
      get().load(envId, dialect, tableDef),
      get().countRows(envId, dialect, tableDef)
    ])
  },

  editCell: (key, col, value) =>
    set((s) => ({ edits: { ...s.edits, [key]: { ...s.edits[key], [col]: value } } })),

  resetCell: (key, col) =>
    set((s) => {
      const row = s.edits[key]
      if (!row || !(col in row)) return {}
      const next = { ...row }
      delete next[col]
      const edits = { ...s.edits }
      if (Object.keys(next).length === 0) delete edits[key]
      else edits[key] = next
      return { edits }
    }),

  toggleDelete: (key) =>
    set((s) => {
      const deletes = { ...s.deletes }
      if (deletes[key]) delete deletes[key]
      else deletes[key] = true
      return { deletes }
    }),

  addRow: () =>
    // tempId 는 충돌 없는 유일값이어야 한다 — 인덱스 기반은 add/remove/add 시 재사용돼 중복 INSERT 를 낳는다.
    set((s) => ({ inserts: [...s.inserts, { tempId: `new_${genUuid()}`, values: {} }] })),

  editInsert: (tempId, col, value) =>
    set((s) => ({
      inserts: s.inserts.map((r) =>
        r.tempId === tempId ? { ...r, values: { ...r.values, [col]: value } } : r
      )
    })),

  removeInsert: (tempId) => set((s) => ({ inserts: s.inserts.filter((r) => r.tempId !== tempId) })),

  discard: () => set({ ...clearPending() }),

  pendingCount: () => {
    const s = get()
    return Object.keys(s.edits).length + Object.keys(s.deletes).length + s.inserts.length
  },

  buildStatements: (dialect, tableDef) => {
    const s = get()
    const pk = pkColumns(tableDef)
    const byKey = new Map(s.rows.map((r) => [rowKey(pk, r), r]))
    const stmts: Statement[] = []

    // 삭제 먼저(편집과 겹치면 삭제 우선)
    for (const key of Object.keys(s.deletes)) {
      const row = byKey.get(key)
      if (!row) continue
      const pkValues = Object.fromEntries(pk.map((c) => [c, row[c]]))
      stmts.push(buildDelete(dialect, tableDef, pk, pkValues))
    }
    // 수정(삭제 대상 제외)
    for (const [key, changes] of Object.entries(s.edits)) {
      if (s.deletes[key]) continue
      if (Object.keys(changes).length === 0) continue
      const row = byKey.get(key)
      if (!row) continue
      const pkValues = Object.fromEntries(pk.map((c) => [c, row[c]]))
      stmts.push(buildUpdate(dialect, tableDef, pk, pkValues, changes))
    }
    // 삽입
    for (const ins of s.inserts) {
      if (Object.keys(ins.values).length === 0) continue
      stmts.push(buildInsert(dialect, tableDef, ins.values))
    }
    return stmts
  },

  save: async (envId, dialect, tableDef) => {
    const stmts = get().buildStatements(dialect, tableDef)
    if (stmts.length === 0) {
      set({ error: '반영할 변경이 없습니다.' })
      return
    }
    set({ loading: true, error: null })
    try {
      const { txId } = await window.rockury.query.txBegin(envId)
      let affected = 0
      for (const st of stmts) {
        const r = await window.rockury.query.txExecParams(txId, st.sql, st.params)
        affected += r.affectedRows ?? 0
      }
      set({ tx: { txId, affected, statements: stmts.length }, loading: false })
    } catch (e) {
      // txExecParams 실패 시 main 이 자동 롤백함.
      set({ error: e instanceof Error ? e.message : String(e), loading: false, tx: null })
    }
  },

  confirm: async (envId, dialect, tableDef) => {
    const tx = get().tx
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      // 커밋된 편집을 History 에 기록(source=data). 실패해도 편집 흐름엔 영향 없음.
      for (const st of get().buildStatements(dialect, tableDef)) {
        try {
          await window.rockury.query.historyAppend({ connectionId: envId, source: 'data', sql: st.sql, kind: 'dml', status: 'success' })
        } catch {
          // 무시
        }
      }
      set({ ...clearPending() })
      // 행을 넣거나 지웠으면 전체 행 수가 바뀐다 — 총 쪽수를 다시 센다.
      await Promise.all([
        get().load(envId, dialect, tableDef),
        get().countRows(envId, dialect, tableDef)
      ])
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
    set({ tx: null }) // pending 버퍼는 유지 → 사용자가 고쳐 재시도
  },

  dismissError: () => set({ error: null })
}))
