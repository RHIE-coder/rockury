import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 컬렉션 저장소(§ops 향상). 순서 있는 쿼리 묶음(Run-All 대상). 연결 스코프.
 * 아이템은 inline SQL(name+sql) — 저장쿼리에서 복사해오거나 직접 입력.
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
  name: string
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
  name: string
  sql_text: string
  sort_order: number
}

const toColl = (r: CollRow): CollectionRecord => ({ id: r.id, connectionId: r.connection_id, name: r.name, sortOrder: r.sort_order })
const toItem = (r: ItemRow): CollectionItemRecord => ({ id: r.id, collectionId: r.collection_id, name: r.name, sql: r.sql_text, sortOrder: r.sort_order })

export function listCollections(connectionId: string): CollectionRecord[] {
  return (
    getDb().prepare('SELECT * FROM collections WHERE connection_id = ? ORDER BY sort_order').all(connectionId) as unknown as CollRow[]
  ).map(toColl)
}

export function listItems(collectionId: string): CollectionItemRecord[] {
  return (
    getDb().prepare('SELECT * FROM collection_items WHERE collection_id = ? ORDER BY sort_order').all(collectionId) as unknown as ItemRow[]
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

export function addItem(input: { collectionId: string; name: string; sql: string }): CollectionItemRecord {
  const d = getDb()
  const id = `ci_${randomUUID()}`
  const { max } = d.prepare('SELECT COALESCE(MAX(sort_order),0) AS max FROM collection_items WHERE collection_id = ?').get(input.collectionId) as unknown as { max: number }
  d.prepare('INSERT INTO collection_items (id, collection_id, name, sql_text, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    id, input.collectionId, input.name, input.sql, max + 1
  )
  return toItem(d.prepare('SELECT * FROM collection_items WHERE id = ?').get(id) as unknown as ItemRow)
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
