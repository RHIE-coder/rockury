import { create } from 'zustand'
import { classifyStatement } from './classify'

/** main queryService.QueryResult 와 동일 형태(구조적). */
export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
}

interface PendingTx {
  txId: string
  verb: string
  affectedRows: number
  destructive: boolean
}

export interface ExplainState {
  summary: string
  planRows: Record<string, unknown>[]
  explainSql: string
}

interface QueryState {
  sql: string
  setSql: (s: string) => void
  result: QueryResult | null
  error: string | null
  loading: boolean
  /** DDL 즉시 실행 후 "자동 커밋" 안내. */
  ddlWarning: boolean
  /** 대기 중 DML 트랜잭션(커밋/롤백 필요). */
  tx: PendingTx | null
  explaining: boolean
  explain: ExplainState | null

  run: (envId: string) => Promise<void>
  runExplain: (connectionId: string) => Promise<void>
  confirm: () => Promise<void>
  rollback: () => Promise<void>
  dismissError: () => void
}

/**
 * Query 실행 스토어(§ops-plan Phase 2c). classify → 라우팅:
 *  - read : 즉시 실행
 *  - dml  : txBegin→txExec(영향행수) → 사용자가 confirm/rollback
 *  - ddl  : 즉시 실행 + 자동 커밋 경고
 */
export const useQueryStore = create<QueryState>()((set, get) => ({
  sql: '',
  setSql: (s) => set({ sql: s }),
  result: null,
  error: null,
  loading: false,
  ddlWarning: false,
  tx: null,
  explaining: false,
  explain: null,

  run: async (envId) => {
    const sql = get().sql
    const c = classifyStatement(sql)
    if (c.kind === 'empty') {
      set({ error: '실행할 SQL 을 입력하세요.' })
      return
    }
    // 이전 대기 트랜잭션이 있으면 먼저 롤백.
    if (get().tx) await get().rollback()
    set({ loading: true, error: null, result: null, ddlWarning: false, tx: null, explain: null })
    try {
      if (c.kind === 'dml') {
        const { txId } = await window.rockury.query.txBegin(envId)
        const r = await window.rockury.query.txExec(txId, sql)
        set({
          result: r,
          tx: { txId, verb: c.verb, affectedRows: r.affectedRows ?? 0, destructive: c.destructive }
        })
      } else {
        const r = await window.rockury.query.run(envId, sql)
        set({ result: r, ddlWarning: c.kind === 'ddl' })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ loading: false })
    }
  },

  runExplain: async (connectionId) => {
    const sql = get().sql
    if (classifyStatement(sql).kind === 'empty') {
      set({ error: '설명할 SQL 을 입력하세요.' })
      return
    }
    set({ explaining: true, error: null, explain: null })
    try {
      const r = await window.rockury.query.explain(connectionId, sql)
      set({ explain: r, explaining: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), explaining: false })
    }
  },

  confirm: async () => {
    const tx = get().tx
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      set({ tx: null })
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
      // 이미 정리됐을 수 있음 — 무시
    }
    set({ tx: null, result: null })
  },

  dismissError: () => set({ error: null })
}))
