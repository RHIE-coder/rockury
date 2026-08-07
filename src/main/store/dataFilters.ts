import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { Filter, SaveFilterInput, SavedFilterRecord } from '../../shared/db/savedFilter'

/**
 * 저장 필터 저장소(§db-remote.data.saved-filter) — Data 화면에서 이름 붙여 남긴 조건 묶음.
 *
 * 주인이 `연결 · 스키마 · 표 이름` 셋인 이유는 이름만으로 가르면 범위(scope)에 스키마가 둘
 * 이상 켜졌을 때 `service1.users` 와 `service2.users` 의 필터가 섞이기 때문이다(§db/schemaRef).
 * 스키마가 빈 문자열이면 "기본 스키마" — 예전 단일 스키마 연결과 같은 자리다.
 */

interface Row {
  id: string
  connection_id: string
  schema_name: string
  table_name: string
  name: string
  filters: string
  created_at: string
  updated_at: string
}

/** 손상된 JSON 이 저장돼 있어도 앱이 죽지 않도록 폴백 — 조건이 없는 필터로 읽힌다. */
function safeFilters(s: string): Filter[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as Filter[]) : []
  } catch {
    return []
  }
}

const toRecord = (r: Row): SavedFilterRecord => ({
  id: r.id,
  connectionId: r.connection_id,
  schema: r.schema_name,
  table: r.table_name,
  name: r.name,
  filters: safeFilters(r.filters),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/** 그 표의 저장 필터 — 만든 순. 다른 표의 것은 섞이지 않는다. */
export function listDataFilters(
  connectionId: string,
  schema: string,
  table: string
): SavedFilterRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM db_data_filters
       WHERE connection_id = ? AND schema_name = ? AND table_name = ?
       ORDER BY created_at`
    )
    .all(connectionId, schema, table) as unknown as Row[]
  return rows.map(toRecord)
}

/** 한 연결에 저장된 전부 — 표가 사라진 것을 골라내는 정리(§AC-5)가 쓴다. */
export function listDataFiltersByConnection(connectionId: string): SavedFilterRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM db_data_filters WHERE connection_id = ? ORDER BY created_at')
    .all(connectionId) as unknown as Row[]
  return rows.map(toRecord)
}

/** `id` 가 있으면 그 항목을 고치고(이름·조건), 없으면 새로 만든다. */
export function saveDataFilter(input: SaveFilterInput): SavedFilterRecord {
  const d = getDb()
  const now = new Date().toISOString()
  const filters = JSON.stringify(input.filters ?? [])
  if (input.id) {
    d.prepare('UPDATE db_data_filters SET name = ?, filters = ?, updated_at = ? WHERE id = ?').run(
      input.name,
      filters,
      now,
      input.id
    )
    return getDataFilter(input.id)!
  }
  const id = randomUUID()
  d.prepare(
    `INSERT INTO db_data_filters
       (id, connection_id, schema_name, table_name, name, filters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.connectionId, input.schema, input.table, input.name, filters, now, now)
  return getDataFilter(id)!
}

export function getDataFilter(id: string): SavedFilterRecord | null {
  const row = getDb().prepare('SELECT * FROM db_data_filters WHERE id = ?').get(id) as unknown as
    | Row
    | undefined
  return row ? toRecord(row) : null
}

export function deleteDataFilter(id: string): void {
  getDb().prepare('DELETE FROM db_data_filters WHERE id = ?').run(id)
}

/**
 * 표가 사라져 쓸모없어진 것들을 지운다. **무엇이 사라졌는지는 렌더러가 판정한다**
 * (`remote/data/savedFilter.orphanedFilterIds`) — 역설계 결과와 그때 읽은 범위를 아는 쪽이
 * 거기라서다. 여기는 넘어온 id 만 지우므로, 빈 목록이면 아무 일도 안 한다.
 */
export function deleteDataFilters(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const d = getDb()
  const stmt = d.prepare('DELETE FROM db_data_filters WHERE id = ?')
  for (const id of ids) stmt.run(id)
  return ids.length
}
