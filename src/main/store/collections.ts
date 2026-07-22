import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 컬렉션 저장소(§ops 향상). 순서 있는 쿼리 묶음(Run-All 대상). 연결 스코프.
 * 아이템은 **저장쿼리 참조**(saved_query_id, 원본 링크 → 원본 수정 시 반영) 또는
 * **즉석 SQL**(sql_text, 라이브러리에 없는 임시 쿼리) 둘 중 하나. name/sql 은 resolve 된 실효값.
 */
export interface CollectionRecord {
  id: string
  connectionId: string
  name: string
  sortOrder: number
}
export interface CollectionItemRecord {
  id: string
  collectionId: string
  /** 참조 대상 저장쿼리 id. null 이면 즉석(ad-hoc) 아이템. */
  savedQueryId: string | null
  /** resolve 된 실효 이름(참조면 원본 쿼리 이름, 아니면 자체 이름). */
  name: string
  /** resolve 된 실효 SQL(참조면 원본 쿼리 SQL, 아니면 자체 SQL). */
  sql: string
  sortOrder: number
}

interface CollRow {
  id: string
  connection_id: string
  name: string
  sort_order: number
}
interface ItemRow {
  id: string
  collection_id: string
  saved_query_id: string | null
  name: string
  sql_text: string
  sort_order: number
  ref_name: string | null
  ref_sql: string | null
}

const toColl = (r: CollRow): CollectionRecord => ({ id: r.id, connectionId: r.connection_id, name: r.name, sortOrder: r.sort_order })
const toItem = (r: ItemRow): CollectionItemRecord => ({
  id: r.id,
  collectionId: r.collection_id,
  savedQueryId: r.saved_query_id,
  // 참조 아이템은 원본 저장쿼리의 이름/SQL 을 실효값으로(원본 수정 시 자동 반영).
  name: r.saved_query_id ? (r.ref_name ?? r.name) : r.name,
  sql: r.saved_query_id ? (r.ref_sql ?? r.sql_text) : r.sql_text,
  sortOrder: r.sort_order
})

export function listCollections(connectionId: string): CollectionRecord[] {
  return (
    getDb().prepare('SELECT * FROM collections WHERE connection_id = ? ORDER BY sort_order').all(connectionId) as unknown as CollRow[]
  ).map(toColl)
}

export function listItems(collectionId: string): CollectionItemRecord[] {
  // 참조 아이템은 saved_queries 를 LEFT JOIN 해 원본 이름/SQL 을 실효값으로 가져온다(원본 수정 자동 반영).
  return (
    getDb()
      .prepare(
        `SELECT ci.*, sq.name AS ref_name, sq.sql_text AS ref_sql
         FROM collection_items ci
         LEFT JOIN saved_queries sq ON sq.id = ci.saved_query_id
         WHERE ci.collection_id = ? ORDER BY ci.sort_order`
      )
      .all(collectionId) as unknown as ItemRow[]
  ).map(toItem)
}

export function createCollection(input: { connectionId: string; name: string }): CollectionRecord {
  const d = getDb()
  const id = `col_${randomUUID()}`
  const now = new Date().toISOString()
  const { max } = d.prepare('SELECT COALESCE(MAX(sort_order),0) AS max FROM collections WHERE connection_id = ?').get(input.connectionId) as unknown as { max: number }
  d.prepare('INSERT INTO collections (id, connection_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, input.connectionId, input.name, max + 1, now, now
  )
  return toColl(d.prepare('SELECT * FROM collections WHERE id = ?').get(id) as unknown as CollRow)
}

export function renameCollection(id: string, name: string): void {
  getDb().prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id)
}

export function deleteCollection(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(id)
    d.prepare('DELETE FROM collections WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function nextSort(d: ReturnType<typeof getDb>, collectionId: string): number {
  const { max } = d.prepare('SELECT COALESCE(MAX(sort_order),0) AS max FROM collection_items WHERE collection_id = ?').get(collectionId) as unknown as { max: number }
  return max + 1
}

function getItem(d: ReturnType<typeof getDb>, id: string): CollectionItemRecord {
  return toItem(
    d
      .prepare(
        `SELECT ci.*, sq.name AS ref_name, sq.sql_text AS ref_sql
         FROM collection_items ci LEFT JOIN saved_queries sq ON sq.id = ci.saved_query_id WHERE ci.id = ?`
      )
      .get(id) as unknown as ItemRow
  )
}

/** 즉석(ad-hoc) 아이템 추가 — 라이브러리에 없는 임시 SQL. */
export function addItem(input: { collectionId: string; name: string; sql: string }): CollectionItemRecord {
  const d = getDb()
  const id = `ci_${randomUUID()}`
  d.prepare('INSERT INTO collection_items (id, collection_id, saved_query_id, name, sql_text, sort_order) VALUES (?, ?, NULL, ?, ?, ?)').run(
    id, input.collectionId, input.name, input.sql, nextSort(d, input.collectionId)
  )
  return getItem(d, id)
}

/** 참조 아이템 추가 — 저장쿼리를 가리킨다(원본 수정 시 반영). */
export function addReference(input: { collectionId: string; savedQueryId: string }): CollectionItemRecord {
  const d = getDb()
  const id = `ci_${randomUUID()}`
  d.prepare('INSERT INTO collection_items (id, collection_id, saved_query_id, name, sql_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, input.collectionId, input.savedQueryId, '', '', nextSort(d, input.collectionId)
  )
  return getItem(d, id)
}

export function updateItem(id: string, patch: { name?: string; sql?: string }): void {
  const d = getDb()
  if (patch.name !== undefined) d.prepare('UPDATE collection_items SET name = ? WHERE id = ?').run(patch.name, id)
  if (patch.sql !== undefined) d.prepare('UPDATE collection_items SET sql_text = ? WHERE id = ?').run(patch.sql, id)
}

export function deleteItem(id: string): void {
  getDb().prepare('DELETE FROM collection_items WHERE id = ?').run(id)
}

export function reorderItems(orderedIds: string[]): void {
  const d = getDb()
  const stmt = d.prepare('UPDATE collection_items SET sort_order = ? WHERE id = ?')
  d.exec('BEGIN')
  try {
    orderedIds.forEach((id, i) => stmt.run(i, id))
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
