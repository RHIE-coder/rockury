import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 쿼리 히스토리 저장소(§ops 향상). rky 의 결함(연결/종류 미기록)을 고쳐:
 *  - connectionId·kind·행수·상태를 모두 기록,
 *  - **매 실행을 별도 행으로 적재**(같은 SQL 을 여러 번 돌려도 실행 횟수만큼 쌓인다 —
 *    사용자 기대: "3번 실행 = 3행". 이전의 연속-중복-접기는 실행이 안 쌓이는 것처럼 보여 제거),
 *  - 연결별 최근 200건만 유지.
 */
/** 실행 소스 — Query 뷰 / Data 편집 / Collection 실행. */
export type HistorySource = 'query' | 'data' | 'collection'

export interface QueryHistoryRecord {
  id: string
  connectionId: string
  source: HistorySource
  sql: string
  kind: string
  status: 'success' | 'error'
  rowCount: number
  affectedRows: number | null
  execMs: number | null
  error: string
  /** 컬렉션 실행일 때: 어느 컬렉션 / 실행배치(run_id) / 그 안 몇 번째(seq). 아니면 null. */
  collectionId: string | null
  collectionName: string | null
  runId: string | null
  seq: number | null
  createdAt: string
}

export interface AppendHistoryInput {
  connectionId: string
  source?: HistorySource
  sql: string
  kind: string
  status: 'success' | 'error'
  rowCount?: number
  affectedRows?: number | null
  execMs?: number | null
  error?: string
  collectionId?: string | null
  collectionName?: string | null
  runId?: string | null
  seq?: number | null
}

interface Row {
  id: string
  connection_id: string
  source: string
  sql_text: string
  kind: string
  status: string
  row_count: number
  affected_rows: number | null
  exec_ms: number | null
  error: string
  collection_id: string | null
  collection_name: string | null
  run_id: string | null
  seq: number | null
  created_at: string
}

const KEEP = 200

const toRecord = (r: Row): QueryHistoryRecord => ({
  id: r.id,
  connectionId: r.connection_id,
  source: (r.source as HistorySource) ?? 'query',
  sql: r.sql_text,
  kind: r.kind,
  status: r.status as 'success' | 'error',
  rowCount: r.row_count,
  affectedRows: r.affected_rows,
  execMs: r.exec_ms,
  error: r.error,
  collectionId: r.collection_id ?? null,
  collectionName: r.collection_name ?? null,
  runId: r.run_id ?? null,
  seq: r.seq ?? null,
  createdAt: r.created_at
})

export function appendHistory(input: AppendHistoryInput): QueryHistoryRecord {
  const d = getDb()
  const now = new Date().toISOString()
  const source: HistorySource = input.source ?? 'query'

  // 매 실행을 별도 행으로 적재한다(중복 접기 없음) — 실행 횟수가 그대로 보이도록.
  const id = `qh_${randomUUID()}`
  d.prepare(
    `INSERT INTO query_history (id, connection_id, source, sql_text, kind, status, row_count, affected_rows, exec_ms, error, collection_id, collection_name, run_id, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.connectionId,
    source,
    input.sql,
    input.kind,
    input.status,
    input.rowCount ?? 0,
    input.affectedRows ?? null,
    input.execMs ?? null,
    input.error ?? '',
    input.collectionId ?? null,
    input.collectionName ?? null,
    input.runId ?? null,
    input.seq ?? null,
    now
  )
  // 오래된 항목 정리(연결별 최근 KEEP 건 유지).
  d.prepare(
    `DELETE FROM query_history WHERE connection_id = ? AND id NOT IN (
       SELECT id FROM query_history WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
     )`
  ).run(input.connectionId, input.connectionId, KEEP)
  return toRecord(
    d.prepare('SELECT * FROM query_history WHERE id = ?').get(id) as unknown as Row
  )
}

export function listHistory(connectionId: string, limit = 100): QueryHistoryRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM query_history WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(connectionId, limit) as unknown as Row[]
  return rows.map(toRecord)
}

export function clearHistory(connectionId: string): void {
  getDb().prepare('DELETE FROM query_history WHERE connection_id = ?').run(connectionId)
}
