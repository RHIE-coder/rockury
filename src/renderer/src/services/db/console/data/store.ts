import { create } from 'zustand'
import type { TableDef } from '../../workspaces/definition/types'
import type { DialectId } from '../../dialects'
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  pkColumns,
  type Filter,
  type Statement
} from './sqlBuilder'
import { genUuid } from './genValue'

/**
 * Data 브라우저 스토어(§ops-plan Phase 2b) — 선택 테이블 행 조회 + pending 편집 버퍼.
 * 커밋은 2c 의 트랜잭션 게이트(txBegin→txExecParams→commit/rollback)를 **파라미터 바인드**로 재사용.
 * PK 없으면 편집 불가(sqlBuilder.canEdit) — 커밋 문 생성 자체가 PK 를 요구한다.
 */
export const PAGE_SIZE = 50
export const PAGE_SIZES = [25, 50, 100, 200] as const
export type SortState = { column: string; direction: 'ASC' | 'DESC' } | null

/** 행 식별 키 — PK 컬럼 값들의 직렬화(원본 행 기준). */
export function rowKey(pkCols: string[], row: Record<string, unknown>): string {
  return JSON.stringify(pkCols.map((c) => row[c] ?? null))
}

interface NewRow {
  tempId: string
  values: Record<string, unknown>
}

interface DataState {
  table: string | null
  columns: string[]
  rows: Record<string, unknown>[]
  page: number
  pageSize: number
  orderBy: SortState
  filters: Filter[]
  loading: boolean
  error: string | null

  // pending 편집 버퍼
  edits: Record<string, Record<string, unknown>>
  deletes: Record<string, true>
  inserts: NewRow[]

  // 트랜잭션 게이트
  tx: { txId: string; affected: number; statements: number } | null

  selectTable: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  load: (envId: string, dialect: DialectId, tableDef: TableDef) => Promise<void>
  setPage: (envId: string, dialect: DialectId, tableDef: TableDef, page: number) => Promise<void>
  setPageSize: (envId: string, dialect: DialectId, tableDef: TableDef, size: number) => Promise<void>
  toggleSort: (envId: string, dialect: DialectId, tableDef: TableDef, column: string) => Promise<void>
  setFilters: (envId: string, dialect: DialectId, tableDef: TableDef, filters: Filter[]) => Promise<void>

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
  page: 0,
  pageSize: PAGE_SIZE,
  orderBy: null,
  filters: [],
  loading: false,
  error: null,
  edits: {},
  deletes: {},
  inserts: [],
  tx: null,

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
    set({ table: tableDef.name, page: 0, orderBy: null, filters: [], ...clearPending() })
    await get().load(envId, dialect, tableDef)
  },

  load: async (envId, dialect, tableDef) => {
    set({ loading: true, error: null })
    try {
      const { pageSize, page, orderBy, filters } = get()
      const { sql, params } = buildSelect(dialect, tableDef.name, {
        limit: pageSize,
        offset: page * pageSize,
        orderBy: orderBy ?? undefined,
        filters
      })
      const r = await window.rockury.query.runParams(envId, sql, params)
      // 컬럼은 introspection 순서를 우선(빈 결과여도 헤더 유지), 없으면 결과 컬럼.
      const columns = tableDef.columns.length ? tableDef.columns.map((c) => c.name) : r.columns
      set({ rows: r.rows, columns, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },

  setPage: async (envId, dialect, tableDef, page) => {
    set({ page: Math.max(0, page) })
    await get().load(envId, dialect, tableDef)
  },

  setPageSize: async (envId, dialect, tableDef, size) => {
    set({ pageSize: size, page: 0 })
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
    set({ orderBy: next, page: 0 })
    await get().load(envId, dialect, tableDef)
  },

  setFilters: async (envId, dialect, tableDef, filters) => {
    set({ filters, page: 0 })
    await get().load(envId, dialect, tableDef)
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
      stmts.push(buildDelete(dialect, tableDef.name, pk, pkValues))
    }
    // 수정(삭제 대상 제외)
    for (const [key, changes] of Object.entries(s.edits)) {
      if (s.deletes[key]) continue
      if (Object.keys(changes).length === 0) continue
      const row = byKey.get(key)
      if (!row) continue
      const pkValues = Object.fromEntries(pk.map((c) => [c, row[c]]))
      stmts.push(buildUpdate(dialect, tableDef.name, pk, pkValues, changes))
    }
    // 삽입
    for (const ins of s.inserts) {
      if (Object.keys(ins.values).length === 0) continue
      stmts.push(buildInsert(dialect, tableDef.name, ins.values))
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
      await get().load(envId, dialect, tableDef)
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
