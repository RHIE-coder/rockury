import { create } from 'zustand'
import { classifyScript, classifyStatement, hasDdl } from './classify'
import { reintrospect } from '../store'

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
  /**
   * 이 트랜잭션에 DDL 이 섞여 있었나 — 커밋/롤백 뒤 역설계를 다시 읽을지의 판정.
   * DDL+DML 스크립트는 게이트를 살리려고 전체가 dml 로 접혀서, 여기 적어 두지 않으면
   * "구조도 바뀌었다"는 사실이 커밋 시점에 남아 있지 않다.
   */
  hadDdl: boolean
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
  collectionId: string | null
  collectionName: string | null
  runId: string | null
  seq: number | null
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
  /**
   * 라이브러리에서 열어 둔 저장쿼리 id — 자동저장이 쓸 대상.
   *
   * **여는 것만으로는 아무것도 안 쓴다.** 쓰기는 사용자가 편집기를 고칠 때만 예약된다
   * (`query/autosave.ts`). 예전엔 "sql 이 바뀌면 쓴다"였고, 여는 것도 바뀜이라 낡은 사본을
   * 열면 그 낡은 것이 저장소를 덮었다(2026-08-12 유실 사고).
   */
  activeSavedQueryId: string | null

  /** 저장쿼리를 편집기로 연다. */
  loadSaved: (id: string, sql: string) => void
  /** execSql 을 주면 그걸 실행(키워드 치환된 SQL). 없으면 state.sql. */
  run: (connectionId: string, execSql?: string) => Promise<void>
  runExplain: (connectionId: string, execSql?: string) => Promise<void>
  confirm: () => Promise<void>
  rollback: () => Promise<void>
  loadHistory: (connectionId: string) => Promise<void>
  /** 바깥에서 난 실패를 그대로 띄운다(자동저장 실패 등) — 조용히 삼키면 "저장이 안 된다"만 남는다. */
  setError: (message: string) => void
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

  loadSaved: (id, sql) => set({ sql, activeSavedQueryId: id }),

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
          tx: {
            txId,
            verb: c.verb,
            affectedRows: r.affectedRows ?? 0,
            destructive: c.destructive,
            hadDdl: hasDdl(sql)
          }
        })
      } else {
        const r = await window.rockury.query.run(connectionId, sql)
        set({ result: r, ddlWarning: c.kind === 'ddl' })
        if (hasDdl(sql)) reintrospect(connectionId)
        await recordHistory(connectionId, sql, c.kind, 'success', { rowCount: r.rowCount, affectedRows: r.affectedRows ?? null, execMs: r.executionTimeMs })
        await get().loadHistory(connectionId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ error: msg })
      // 실패해도 다시 읽는다 — 여러 문 스크립트는 앞 문이 이미 나간 뒤 뒤 문에서 깨질 수 있고,
      // 그때 화면이 든 목록은 이미 실제와 다르다.
      if (hasDdl(sql)) reintrospect(connectionId)
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
      if (tx.hadDdl && lastConn) reintrospect(lastConn)
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
    const lastConn = get().lastConn
    try {
      await window.rockury.query.txRollback(tx.txId)
    } catch {
      // 이미 정리됐을 수 있음 — 무시
    }
    set({ tx: null, result: null })
    // 되돌려도 다시 읽는다 — MySQL 은 DDL 을 못 되돌리므로 구조가 그대로 바뀐 채 남는다.
    // 되돌아가는 벤더(PostgreSQL)면 되돌아간 모습을 읽어 오니 어느 쪽이든 화면이 실제와 맞는다.
    if (tx.hadDdl && lastConn) reintrospect(lastConn)
  },

  loadHistory: async (connectionId) => {
    try {
      const rows = (await window.rockury.query.historyList(connectionId)) as HistoryRow[]
      set({ history: rows })
    } catch {
      // 무시
    }
  },

  setError: (message) => set({ error: message }),
  dismissError: () => set({ error: null })
}))
