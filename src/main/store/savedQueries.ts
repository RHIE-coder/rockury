import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { ownerColumns, ownerWhere, type LibraryScope } from './libraryScope'

/**
 * 저장 쿼리 라이브러리 저장소(§ops 향상 — Collection). 폴더 트리.
 *
 * 스코프는 **설계 아니면 연결**이다(2026-08-04 — 왜 그런지는 `@shared/db/libraryOwner`).
 * 예전엔 연결 하나뿐이라 같은 DB 의 DEV·STG·PROD 가 같은 쿼리를 세 벌 만들어야 했다.
 * 트리 재배치(reparent+reorder)는 렌더러가 계산한 (id,parentId,sortOrder) 목록을 한 번에 반영.
 */
export interface FolderRecord {
  id: string
  connectionId: string
  designId: string
  parentId: string | null
  name: string
  sortOrder: number
}
export interface SavedQueryRecord {
  id: string
  connectionId: string
  designId: string
  folderId: string | null
  name: string
  description: string
  sql: string
  sortOrder: number
}

interface FolderRow {
  id: string
  connection_id: string
  design_id: string
  parent_id: string | null
  name: string
  sort_order: number
}
interface QueryRow {
  id: string
  connection_id: string
  design_id: string
  folder_id: string | null
  name: string
  description: string
  sql_text: string
  sort_order: number
}

const toFolder = (r: FolderRow): FolderRecord => ({
  id: r.id,
  connectionId: r.connection_id,
  designId: r.design_id ?? '',
  parentId: r.parent_id,
  name: r.name,
  sortOrder: r.sort_order
})
const toQuery = (r: QueryRow): SavedQueryRecord => ({
  id: r.id,
  connectionId: r.connection_id,
  designId: r.design_id ?? '',
  folderId: r.folder_id,
  name: r.name,
  description: r.description ?? '',
  sql: r.sql_text,
  sortOrder: r.sort_order
})

export function listTree(scope: LibraryScope): {
  folders: FolderRecord[]
  queries: SavedQueryRecord[]
} {
  const d = getDb()
  const w = ownerWhere(scope)
  const folders = (
    d.prepare(`SELECT * FROM query_folders WHERE ${w.sql} ORDER BY sort_order`).all(...w.params) as unknown as FolderRow[]
  ).map(toFolder)
  const queries = (
    d.prepare(`SELECT * FROM saved_queries WHERE ${w.sql} ORDER BY sort_order`).all(...w.params) as unknown as QueryRow[]
  ).map(toQuery)
  return { folders, queries }
}

/** 새 것이 설 자리(sort_order) — **보이는 범위 전체**에서 잰다. 소속별로 따로 세면 순서가 겹친다. */
function nextOrder(table: string, scope: LibraryScope): number {
  const w = ownerWhere(scope)
  const { max } = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order),0) AS max FROM ${table} WHERE ${w.sql}`)
    .get(...w.params) as unknown as { max: number }
  return max + 1
}

export function createFolder(input: { scope: LibraryScope; parentId: string | null; name: string }): FolderRecord {
  const d = getDb()
  const id = `qf_${randomUUID()}`
  const now = new Date().toISOString()
  const owner = ownerColumns(input.scope)
  d.prepare(
    'INSERT INTO query_folders (id, connection_id, design_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, owner.connectionId, owner.designId, input.parentId, input.name, nextOrder('query_folders', input.scope), now, now)
  return toFolder(d.prepare('SELECT * FROM query_folders WHERE id = ?').get(id) as unknown as FolderRow)
}

export function createSavedQuery(input: {
  scope: LibraryScope
  folderId: string | null
  name: string
  sql: string
}): SavedQueryRecord {
  const d = getDb()
  const id = `sq_${randomUUID()}`
  const now = new Date().toISOString()
  const owner = ownerColumns(input.scope)
  d.prepare(
    'INSERT INTO saved_queries (id, connection_id, design_id, folder_id, name, sql_text, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, owner.connectionId, owner.designId, input.folderId, input.name, input.sql, nextOrder('saved_queries', input.scope), now, now)
  return toQuery(d.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id) as unknown as QueryRow)
}

export function renameFolder(id: string, name: string): void {
  getDb().prepare('UPDATE query_folders SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id)
}
export function updateSavedQuery(id: string, patch: { name?: string; description?: string; sql?: string }): void {
  const d = getDb()
  const now = new Date().toISOString()
  if (patch.name !== undefined) d.prepare('UPDATE saved_queries SET name = ?, updated_at = ? WHERE id = ?').run(patch.name, now, id)
  if (patch.description !== undefined) d.prepare('UPDATE saved_queries SET description = ?, updated_at = ? WHERE id = ?').run(patch.description, now, id)
  if (patch.sql !== undefined) d.prepare('UPDATE saved_queries SET sql_text = ?, updated_at = ? WHERE id = ?').run(patch.sql, now, id)
}

/** 폴더 삭제 — 하위 폴더/쿼리까지 cascade. */
export function deleteFolder(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    const descend = (fid: string): void => {
      const children = d.prepare('SELECT id FROM query_folders WHERE parent_id = ?').all(fid) as unknown as { id: string }[]
      for (const c of children) descend(c.id)
      d.prepare('DELETE FROM saved_queries WHERE folder_id = ?').run(fid)
      d.prepare('DELETE FROM query_folders WHERE id = ?').run(fid)
    }
    descend(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function deleteSavedQuery(id: string): void {
  const d = getDb()
  // 삭제 가드 — 컬렉션이 이 쿼리를 참조 중이면 거부하고 어느 컬렉션인지 알린다.
  const refs = d
    .prepare(
      `SELECT DISTINCT c.name AS name FROM collection_items ci
       JOIN collections c ON c.id = ci.collection_id WHERE ci.saved_query_id = ?`
    )
    .all(id) as unknown as { name: string }[]
  if (refs.length > 0) {
    throw new Error(`이 쿼리는 컬렉션에서 사용 중이라 삭제할 수 없습니다: ${refs.map((r) => r.name).join(', ')}`)
  }
  d.prepare('DELETE FROM saved_queries WHERE id = ?').run(id)
}

/** 트리 재배치 — 렌더러가 계산한 (id,kind,parentId,sortOrder)를 일괄 반영. */
export function reorderTree(
  items: { id: string; kind: 'folder' | 'query'; parentId: string | null; sortOrder: number }[]
): void {
  const d = getDb()
  const now = new Date().toISOString()
  const uf = d.prepare('UPDATE query_folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
  const uq = d.prepare('UPDATE saved_queries SET folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
  d.exec('BEGIN')
  try {
    items.forEach((it, i) => {
      if (it.kind === 'folder') uf.run(it.parentId, i, now, it.id)
      else uq.run(it.parentId, i, now, it.id)
    })
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
