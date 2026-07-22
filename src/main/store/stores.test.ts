import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDbPath } from './db'
import {
  createFolder,
  createSavedQuery,
  deleteFolder,
  deleteSavedQuery,
  listTree,
  reorderTree,
  updateSavedQuery
} from './savedQueries'
import {
  addItem,
  addReference,
  createCollection,
  deleteCollection,
  deleteItem,
  listCollections,
  listItems,
  reorderItems
} from './collections'
import { appendHistory, listHistory } from './queryHistory'
import { appendLog, latestSnapshot, listLogs, saveSnapshot } from './migration'
import { createConnection, deleteConnection, getConnectionWithPassword, listConnections } from './connections'
import { ensureBinding, getEnvironment, setAppliedVersion } from './environments'

/**
 * 로컬 저장소 통합 테스트 — 임시 SQLite(setDbPath) 위에서 실제 SQL 로직을 검증한다.
 * electron/docker 불필요 → 기본 `npm test` 에 포함. 실 앱 DB 무관.
 * 방금 붙인 ops 스토어(savedQueries/collections/queryHistory/migration/connections/environments)
 * 의 트리 cascade·정렬·dedup·checksum·바인딩 멱등 등 "e2e 로만 덮였던 글루"를 덮는다.
 */
beforeAll(() => {
  setDbPath(join(mkdtempSync(join(tmpdir(), 'rockury-store-')), 'test.db'))
})

const CONN = 'conn_test'

describe('savedQueries (폴더 트리)', () => {
  it('생성·트리·cascade 삭제·재배치', () => {
    const root = createFolder({ connectionId: CONN, parentId: null, name: 'root' })
    const child = createFolder({ connectionId: CONN, parentId: root.id, name: 'child' })
    const q = createSavedQuery({ connectionId: CONN, folderId: root.id, name: 'q1', sql: 'SELECT 1' })
    let tree = listTree(CONN)
    expect(tree.folders.map((f) => f.name).sort()).toEqual(['child', 'root'])
    expect(tree.queries.map((x) => x.name)).toEqual(['q1'])

    // 재배치: q1 을 child 로 이동
    reorderTree([{ id: q.id, kind: 'query', parentId: child.id, sortOrder: 0 }])
    expect(listTree(CONN).queries[0].folderId).toBe(child.id)

    // root 삭제 → child + q1 까지 cascade
    deleteFolder(root.id)
    tree = listTree(CONN)
    expect(tree.folders).toEqual([])
    expect(tree.queries).toEqual([])
  })
})

describe('collections', () => {
  it('생성·아이템 순서·재정렬·cascade 삭제', () => {
    const col = createCollection({ connectionId: CONN, name: 'batch' })
    const a = addItem({ collectionId: col.id, name: 'a', sql: 'SELECT 1' })
    const b = addItem({ collectionId: col.id, name: 'b', sql: 'SELECT 2' })
    expect(listItems(col.id).map((i) => i.name)).toEqual(['a', 'b'])

    reorderItems([b.id, a.id])
    expect(listItems(col.id).map((i) => i.name)).toEqual(['b', 'a'])

    deleteCollection(col.id)
    expect(listCollections(CONN).find((c) => c.id === col.id)).toBeUndefined()
    expect(listItems(col.id)).toEqual([])
  })
})

describe('collections — 저장쿼리 참조(hybrid) + 삭제 가드', () => {
  it('참조 아이템은 원본 이름/SQL 을 실효값으로, 원본 수정 시 반영', () => {
    const q = createSavedQuery({ connectionId: CONN, folderId: null, name: 'ref-q', sql: 'SELECT 42' })
    const col = createCollection({ connectionId: CONN, name: 'refs' })
    const item = addReference({ collectionId: col.id, savedQueryId: q.id })
    const items = listItems(col.id)
    expect(items[0].savedQueryId).toBe(q.id)
    expect(items[0].name).toBe('ref-q')
    expect(items[0].sql).toBe('SELECT 42')

    // 원본 수정 → 참조 아이템에 자동 반영(사본이 아니라 링크)
    updateSavedQuery(q.id, { sql: 'SELECT 99' })
    expect(listItems(col.id)[0].sql).toBe('SELECT 99')

    // 참조 중 원본 삭제는 거부(삭제 가드)
    expect(() => deleteSavedQuery(q.id)).toThrow(/사용 중/)
    // 참조 제거 후엔 삭제 가능
    deleteItem(item.id)
    expect(() => deleteSavedQuery(q.id)).not.toThrow()
  })

  it('즉석(ad-hoc) 아이템은 savedQueryId=null 이고 자체 SQL 을 쓴다', () => {
    const col = createCollection({ connectionId: CONN, name: 'adhoc' })
    addItem({ collectionId: col.id, name: 'x', sql: 'SELECT 1' })
    const it = listItems(col.id)[0]
    expect(it.savedQueryId).toBeNull()
    expect(it.sql).toBe('SELECT 1')
  })
})

describe('queryHistory (dedup)', () => {
  it('연속 동일 쿼리는 1행으로 접고, 다른 쿼리는 새 행', () => {
    const c = 'conn_hist'
    appendHistory({ connectionId: c, sql: 'SELECT 1', kind: 'read', status: 'success', rowCount: 1 })
    appendHistory({ connectionId: c, sql: 'SELECT   1', kind: 'read', status: 'success', rowCount: 1 }) // 공백만 다름 → dedup
    expect(listHistory(c)).toHaveLength(1)
    appendHistory({ connectionId: c, sql: 'SELECT 2', kind: 'read', status: 'success', rowCount: 1 })
    const rows = listHistory(c)
    expect(rows).toHaveLength(2)
    expect(rows[0].sql).toBe('SELECT 2') // 최신순
  })
})

describe('migration (스냅샷 + 로그)', () => {
  it('스냅샷 저장→최신 조회(checksum), 로그 append→list', () => {
    const env = 'env_test'
    const snap = { tables: [{ id: 't:x', name: 'x' }] }
    saveSnapshot({ envId: env, version: 'v1', snapshot: snap })
    const latest = latestSnapshot(env)
    expect(latest?.version).toBe('v1')
    expect(latest?.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(latest?.snapshot).toEqual(snap)

    appendLog({ envId: env, kind: 'apply', fromVersion: '', toVersion: 'v1', summary: '반영' })
    const logs = listLogs(env)
    expect(logs).toHaveLength(1)
    expect(logs[0].kind).toBe('apply')
  })
})

describe('connections + environments 바인딩', () => {
  it('연결 CRUD, 삭제 시 바인딩 cascade, 바인딩 멱등/버전 갱신', () => {
    const conn = createConnection({
      name: 'c1', dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
      encryptedPassword: 'enc', sslEnabled: false
    })
    expect(listConnections().find((c) => c.id === conn.id)?.name).toBe('c1')
    expect(getConnectionWithPassword(conn.id)?.encryptedPassword).toBe('enc')

    // 바인딩 멱등: 같은 (conn, design) → 같은 id
    const b1 = ensureBinding(conn.id, 'design1', 'v1')
    const b2 = ensureBinding(conn.id, 'design1')
    expect(b2.id).toBe(b1.id)
    expect(b2.targetVersion).toBe('v1')
    setAppliedVersion(b1.id, 'v1')
    expect(getEnvironment(b1.id)?.appliedVersion).toBe('v1')

    // 연결 삭제 → 바인딩 cascade
    deleteConnection(conn.id)
    expect(getEnvironment(b1.id)).toBeNull()
  })
})
