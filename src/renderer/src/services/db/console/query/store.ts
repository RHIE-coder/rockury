import { create } from 'zustand'
import { classifyScript, classifyStatement } from './classify'

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

export interface HistoryRow {
  id: string
  connectionId: string
  source: string
  sql: string
  kind: string
  status: 'success' | 'error'
  rowCount: number
  affectedRows: number | null
  execMs: number | null
  error: string
  createdAt: string
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
  history: HistoryRow[]
  lastConn: string | null
  /** 라이브러리에서 로드된 저장쿼리 id — 있으면 자동저장 대상(T17). */
  activeSavedQueryId: string | null
  /** 그 저장쿼리가 속한 연결 id — 자동저장은 이 연결에서만(다른 연결 작업물이 덮어쓰지 않도록). */
  activeSavedConn: string | null

  /** 저장쿼리를 에디터로 로드(자동저장 연결 — 연결 id 로 스코프). */
  loadSaved: (id: string, sql: string, connId: string) => void
  /** execSql 을 주면 그걸 실행(키워드 치환된 SQL). 없으면 state.sql. */
  run: (connectionId: string, execSql?: string) => Promise<void>
  runExplain: (connectionId: string, execSql?: string) => Promise<void>
  confirm: () => Promise<void>
  rollback: () => Promise<void>
  loadHistory: (connectionId: string) => Promise<void>
  dismissError: () => void
}

/**
 * Query 실행 스토어(§ops-plan Phase 2c). classify → 라우팅:
 *  - read : 즉시 실행
 *  - dml  : txBegin→txExec(영향행수) → 사용자가 confirm/rollback
 *  - ddl  : 즉시 실행 + 자동 커밋 경고
 */
async function recordHistory(
  connectionId: string,
  sql: string,
  kind: string,
  status: 'success' | 'error',
  extra: { rowCount?: number; affectedRows?: number | null; execMs?: number | null; error?: string } = {}
): Promise<void> {
  try {
    await window.rockury.query.historyAppend({ connectionId, sql, kind, status, ...extra })
  } catch {
    // 히스토리 기록 실패는 실행 자체에 영향 주지 않음 — 무시.
  }
}

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
  history: [],
  lastConn: null,
  activeSavedQueryId: null,
  activeSavedConn: null,

  loadSaved: (id, sql, connId) => set({ sql, activeSavedQueryId: id, activeSavedConn: connId }),

  run: async (connectionId, execSql) => {
    const sql = execSql ?? get().sql
    // ⭐ 스크립트 전체를 보고 라우팅한다 — 첫 문만 보면 뒤에 숨은 DML 이 게이트를 우회해 자동 커밋된다.
    const c = classifyScript(sql)
    if (c.kind === 'empty') {
      set({ error: '실행할 SQL 을 입력하세요.' })
      return
    }
    // 이전 대기 트랜잭션이 있으면 먼저 롤백.
    if (get().tx) await get().rollback()
    set({ loading: true, error: null, result: null, ddlWarning: false, tx: null, explain: null, lastConn: connectionId })
    try {
      if (c.kind === 'dml') {
        // DML 은 프리뷰 — 히스토리는 커밋 시점에 기록.
        const { txId } = await window.rockury.query.txBegin(connectionId)
        const r = await window.rockury.query.txExec(txId, sql)
        set({
          result: r,
          tx: { txId, verb: c.verb, affectedRows: r.affectedRows ?? 0, destructive: c.destructive }
        })
      } else {
        const r = await window.rockury.query.run(connectionId, sql)
        set({ result: r, ddlWarning: c.kind === 'ddl' })
        await recordHistory(connectionId, sql, c.kind, 'success', { rowCount: r.rowCount, affectedRows: r.affectedRows ?? null, execMs: r.executionTimeMs })
        await get().loadHistory(connectionId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg })
      if (c.kind !== 'dml') {
        await recordHistory(connectionId, sql, c.kind, 'error', { error: msg })
        await get().loadHistory(connectionId)
      }
    } finally {
      set({ loading: false })
    }
  },

  runExplain: async (connectionId, execSql) => {
    const sql = execSql ?? get().sql
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
    const { tx, lastConn, sql } = get()
    if (!tx) return
    try {
      await window.rockury.query.txCommit(tx.txId)
      set({ tx: null })
      if (lastConn) {
        await recordHistory(lastConn, sql, 'dml', 'success', { affectedRows: tx.affectedRows })
        await get().loadHistory(lastConn)
      }
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

  loadHistory: async (connectionId) => {
    try {
      const rows = (await window.rockury.query.historyList(connectionId)) as HistoryRow[]
      set({ history: rows })
    } catch {
      // 무시
    }
  },

  dismissError: () => set({ error: null })
}))
