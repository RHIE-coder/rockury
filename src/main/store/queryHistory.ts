import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { normalizeSqlKey } from '../services/query/historyKey'

/**
 * 쿼리 히스토리 저장소(§ops 향상). rky 의 결함(연결/종류 미기록, dedup 없음)을 고쳐:
 *  - connectionId·kind·행수·상태를 모두 기록,
 *  - **직전 동일 쿼리는 새 행 대신 시각/통계만 갱신**(연속 중복 접기),
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
  createdAt: r.created_at
})

export function appendHistory(input: AppendHistoryInput): QueryHistoryRecord {
  const d = getDb()
  const now = new Date().toISOString()
  const source: HistorySource = input.source ?? 'query'
  const latest = d
    .prepare('SELECT * FROM query_history WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(input.connectionId) as Row | undefined

  // 직전 항목과 동일 소스·쿼리면 갱신(중복 접기).
  if (latest && latest.source === source && normalizeSqlKey(latest.sql_text) === normalizeSqlKey(input.sql)) {
    d.prepare(
      'UPDATE query_history SET kind=?, status=?, row_count=?, affected_rows=?, exec_ms=?, error=?, created_at=? WHERE id=?'
    ).run(
      input.kind,
      input.status,
      input.rowCount ?? 0,
      input.affectedRows ?? null,
      input.execMs ?? null,
      input.error ?? '',
      now,
      latest.id
    )
    return toRecord({ ...latest, kind: input.kind, status: input.status, row_count: input.rowCount ?? 0, affected_rows: input.affectedRows ?? null, exec_ms: input.execMs ?? null, error: input.error ?? '', created_at: now })
  }

  const id = `qh_${randomUUID()}`
  d.prepare(
    `INSERT INTO query_history (id, connection_id, source, sql_text, kind, status, row_count, affected_rows, exec_ms, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
