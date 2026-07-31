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
import { listTables, replaceTablesForDesign, type TableRecord } from './tables'
import { listSeedSets, replaceSeedSetsForDesign, type SeedSetRecord } from './seedSets'
import { createDesign, deleteDesign } from './designs'
import { clearLayout, getLayout, saveLayout } from './diagramLayouts'
import { appendLog, latestSnapshot, listLogs, saveSnapshot } from './migration'
import { createVersion, deleteVersion, listVersions } from './versions'
import {
  createConnection,
  createConnectionGroup,
  deleteConnection,
  deleteConnectionGroup,
  getConnection,
  getConnectionGroup,
  getConnectionWithPassword,
  listConnectionGroups,
  listConnections,
  moveConnection,
  renameConnectionGroup,
  reorderConnectionGroups,
  updateConnection
} from './connections'
import {
  deleteBinding,
  ensureBinding,
  getEnvironment,
  listBindingsByConnection,
  setAppliedVersion
} from './environments'

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

describe('queryHistory (매 실행 적재)', () => {
  it('같은 SQL 을 여러 번 실행하면 실행 횟수만큼 행이 쌓인다(중복 접기 없음)', () => {
    const c = 'conn_hist'
    // 같은 SELECT 를 3번 → 3행이 그대로 쌓여야 한다("3번 실행 = 3행").
    appendHistory({ connectionId: c, sql: 'SELECT 1', kind: 'read', status: 'success', rowCount: 1 })
    appendHistory({ connectionId: c, sql: 'SELECT   1', kind: 'read', status: 'success', rowCount: 1 })
    appendHistory({ connectionId: c, sql: 'SELECT 1', kind: 'read', status: 'success', rowCount: 1 })
    expect(listHistory(c)).toHaveLength(3)
    appendHistory({ connectionId: c, sql: 'SELECT 2', kind: 'read', status: 'success', rowCount: 1 })
    const rows = listHistory(c)
    expect(rows).toHaveLength(4)
    expect(rows[0].sql).toBe('SELECT 2') // 최신순
  })
})

describe('queryHistory (다중 소스)', () => {
  it('source 를 기록·구분하고, 같은 소스 동일 SQL 도 매 실행 적재한다', () => {
    const c = 'conn_src'
    appendHistory({ connectionId: c, source: 'query', sql: 'SELECT 1', kind: 'read', status: 'success', rowCount: 1 })
    appendHistory({ connectionId: c, source: 'data', sql: 'SELECT 1', kind: 'read', status: 'success', rowCount: 1 })
    const rows = listHistory(c)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.source).sort()).toEqual(['data', 'query'])

    // 같은 소스 연속 동일 SQL → 접지 않고 새 행.
    appendHistory({ connectionId: c, source: 'data', sql: 'SELECT   1', kind: 'read', status: 'success', rowCount: 1 })
    expect(listHistory(c)).toHaveLength(3)
  })

  it('source 미지정 시 기본 query', () => {
    const c = 'conn_src_default'
    appendHistory({ connectionId: c, sql: 'SELECT 2', kind: 'read', status: 'success' })
    expect(listHistory(c)[0].source).toBe('query')
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
    expect(conn.autoCheckDisabled).toBe(false) // 기본값 — 자동확인 대상

    // 자동확인 무시 플래그 왕복(생성 시 지정 + 갱신)
    const skipped = createConnection({
      name: 'c-skip', dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
      encryptedPassword: 'enc', sslEnabled: false, autoCheckDisabled: true
    })
    expect(getConnection(skipped.id)?.autoCheckDisabled).toBe(true)
    updateConnection(skipped.id, { autoCheckDisabled: false })
    expect(getConnection(skipped.id)?.autoCheckDisabled).toBe(false)

    // 범위(보고 있는 스키마 목록) 왕복 — 안 적고 만든 연결은 빈 배열, 곧 "기본 스키마 하나".
    expect(conn.schemas).toEqual([])
    updateConnection(skipped.id, { schemas: ['public', 'auth'] })
    expect(getConnection(skipped.id)?.schemas).toEqual(['public', 'auth'])
    updateConnection(skipped.id, { schemas: [] })
    expect(getConnection(skipped.id)?.schemas).toEqual([])

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

  it('그룹 CRUD·이동: 생성 순 정렬, 이름변경, 이동(그룹↔미분류)+전역 순서, 삭제 시 소속 해제', () => {
    const mk = (name: string) =>
      createConnection({
        name, dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
        encryptedPassword: 'enc', sslEnabled: false
      })
    const a = mk('g-a')
    const b = mk('g-b')
    const c = mk('g-c')

    const g1 = createConnectionGroup('운영')
    const g2 = createConnectionGroup('개발')
    expect(listConnectionGroups().map((g) => g.name)).toEqual(['운영', '개발']) // 생성 순
    expect(a.groupId).toBeNull() // 기본값 — 미분류

    renameConnectionGroup(g1.id, '스테이징')
    expect(getConnectionGroup(g1.id)?.name).toBe('스테이징')

    // 순서 변경: g2 를 앞으로
    reorderConnectionGroups([g2.id, g1.id])
    expect(listConnectionGroups().map((g) => g.id)).toEqual([g2.id, g1.id])
    reorderConnectionGroups([g1.id, g2.id]) // 원복(이후 단정 유지)

    // 이동: b 를 g1 로 + 전역 순서 [b, a, c]
    const moved = moveConnection(b.id, g1.id, [b.id, a.id, c.id])
    expect(moved.groupId).toBe(g1.id)
    const names = () => listConnections().filter((x) => [a.id, b.id, c.id].includes(x.id)).map((x) => x.name)
    expect(names()).toEqual(['g-b', 'g-a', 'g-c'])

    // 미분류로 빼기 + 순서 복귀
    expect(moveConnection(b.id, null, [a.id, b.id, c.id]).groupId).toBeNull()
    expect(names()).toEqual(['g-a', 'g-b', 'g-c'])

    // 없는 그룹/연결 이동은 거부
    expect(() => moveConnection(b.id, 'cgrp_없음', [a.id, b.id, c.id])).toThrow()
    expect(() => moveConnection('conn_없음', null, [])).toThrow()

    // 그룹 삭제 → 소속 연결은 살아남고 미분류로
    moveConnection(c.id, g2.id, [a.id, b.id, c.id])
    deleteConnectionGroup(g2.id)
    expect(getConnectionGroup(g2.id)).toBeNull()
    expect(getConnection(c.id)?.groupId).toBeNull()

    deleteConnection(a.id)
    deleteConnection(b.id)
    deleteConnection(c.id)
    deleteConnectionGroup(g1.id)
  })

  it('listByConnection: 한 연결의 바인딩 전부를 오래된 순으로, 다른 연결과 격리', () => {
    const conn = createConnection({
      name: 'c-list', dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
      encryptedPassword: 'enc', sslEnabled: false
    })
    const other = createConnection({
      name: 'c-other', dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
      encryptedPassword: 'enc', sslEnabled: false
    })
    const e1 = ensureBinding(conn.id, 'design_a', 'v1')
    const e2 = ensureBinding(conn.id, 'design_b', 'v2')
    ensureBinding(other.id, 'design_a', 'v1')

    const list = listBindingsByConnection(conn.id)
    expect(list.map((b) => b.id)).toEqual([e1.id, e2.id]) // 생성 순(오래된 순)
    expect(list.every((b) => b.connectionId === conn.id)).toBe(true)
    expect(listBindingsByConnection(other.id)).toHaveLength(1) // 격리
  })

  it('deleteBinding: 바인딩 + 딸린 스냅샷·로그를 함께 정리(멱등)', () => {
    const conn = createConnection({
      name: 'c-del', dbType: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u',
      encryptedPassword: 'enc', sslEnabled: false
    })
    const env = ensureBinding(conn.id, 'design_x', 'v1')
    saveSnapshot({ envId: env.id, version: 'v1', snapshot: { tables: [] } })
    appendLog({ envId: env.id, kind: 'baseline', toVersion: 'v1', summary: '가져오기' })
    expect(latestSnapshot(env.id)).not.toBeNull()
    expect(listLogs(env.id)).toHaveLength(1)

    deleteBinding(env.id)
    expect(getEnvironment(env.id)).toBeNull()
    expect(latestSnapshot(env.id)).toBeNull() // 스냅샷 연쇄 정리
    expect(listLogs(env.id)).toEqual([]) // 로그 연쇄 정리

    // 없는 id 재삭제해도 안전(멱등) — throw 하지 않는다.
    expect(() => deleteBinding(env.id)).not.toThrow()
  })
})

describe('tables — 설계 스코프 교체 (replaceTablesForDesign)', () => {
  const tbl = (designId: string, id: string, name: string): TableRecord => ({
    id,
    designId,
    name,
    comment: '',
    columns: [{ id: `${id}-c1`, name: 'id', type: 'int', nullable: false, defaultValue: null, comment: '' }],
    constraints: [{ id: `${id}-k1`, kind: 'pk', name: '', columns: [{ columnId: `${id}-c1` }] }]
  })

  it('CASE-ai-030/033: 대상 설계만 교체 — 다른 설계 행 불변 + 순서(position)·JSON 왕복 유지', () => {
    replaceTablesForDesign('scope_x', [tbl('scope_x', 'x1', 'alpha'), tbl('scope_x', 'x2', 'beta')])
    replaceTablesForDesign('scope_y', [tbl('scope_y', 'y1', 'gamma')])
    const yBefore = listTables().filter((t) => t.designId === 'scope_y')

    // X 재교체 — 순서 변경 + 내용 변경. Y 는 바이트 단위로 그대로여야 한다.
    replaceTablesForDesign('scope_x', [tbl('scope_x', 'x3', 'delta'), tbl('scope_x', 'x1', 'alpha2')])
    const xs = listTables().filter((t) => t.designId === 'scope_x')
    expect(xs.map((t) => t.name)).toEqual(['delta', 'alpha2']) // 저장 순서 유지
    expect(xs[0].columns).toEqual(tbl('scope_x', 'x3', 'delta').columns) // JSON 왕복 정합
    expect(xs[0].constraints).toEqual(tbl('scope_x', 'x3', 'delta').constraints)
    expect(listTables().filter((t) => t.designId === 'scope_y')).toEqual(yBefore) // 격리
  })

  it('CASE-ai-031: 빈 목록 → 설계 비우기, 다른 설계 불변', () => {
    replaceTablesForDesign('scope_x', [])
    expect(listTables().filter((t) => t.designId === 'scope_x')).toEqual([])
    expect(listTables().filter((t) => t.designId === 'scope_y')).toHaveLength(1)
  })

  it('스키마가 저장 왕복에서 살아남고, 안 적은 테이블은 기본 스키마(undefined)로 돌아온다', () => {
    // 예전 행은 schema_name 이 빈 문자열로 채워진다 — 그것이 곧 "기본 스키마"이며,
    // 여기서 undefined 로 되돌아와야 `schemaRef` 의 빈-스키마 규칙과 맞물린다.
    replaceTablesForDesign('scope_ns', [
      { ...tbl('scope_ns', 'n1', 'users'), schema: 'auth' },
      tbl('scope_ns', 'n2', 'posts')
    ])
    const got = listTables().filter((t) => t.designId === 'scope_ns')
    expect(got.map((t) => [t.name, t.schema])).toEqual([
      ['users', 'auth'],
      ['posts', undefined]
    ])
  })

  it('같은 이름 테이블이 스키마만 달리해 공존한다 — 범위를 켜면 실제로 생기는 모양', () => {
    replaceTablesForDesign('scope_dup', [
      { ...tbl('scope_dup', 'd1', 'users'), schema: 'public' },
      { ...tbl('scope_dup', 'd2', 'users'), schema: 'auth' }
    ])
    const got = listTables().filter((t) => t.designId === 'scope_dup')
    expect(got.map((t) => t.schema)).toEqual(['public', 'auth'])
  })

  it('뷰 표식(isView)이 저장 왕복에서 살아남는다 — 설계 목록의 테이블/뷰 구분 근거', () => {
    const view = { ...tbl('scope_v', 'v1', 'v_active_products'), isView: true }
    replaceTablesForDesign('scope_v', [view, tbl('scope_v', 'v2', 'products')])
    const got = listTables().filter((t) => t.designId === 'scope_v')
    expect(got.map((t) => [t.name, t.isView])).toEqual([
      ['v_active_products', true],
      // 표식 없이 저장한 테이블은 뷰가 아니다(undefined 가 아니라 false 로 정규화).
      ['products', false]
    ])
  })

  it('뷰 본문(viewSql)이 저장 왕복에서 살아남는다 — 없으면 CREATE VIEW 를 만들 수 없다', () => {
    const body = 'SELECT id, name FROM products WHERE deleted_at IS NULL'
    replaceTablesForDesign('scope_vs', [
      { ...tbl('scope_vs', 'vs1', 'v_active'), isView: true, viewSql: body },
      tbl('scope_vs', 'vs2', 'products')
    ])
    const got = listTables().filter((t) => t.designId === 'scope_vs')
    expect(got.map((t) => [t.name, t.viewSql])).toEqual([
      ['v_active', body],
      // 뷰가 아닌 테이블은 빈 문자열로 정규화(undefined 가 섞여 들어오지 않게).
      ['products', '']
    ])
  })

  it('CASE-ai-032: 다른 설계 레코드가 섞인 배치는 전체 롤백 — 부분 반영 0', () => {
    replaceTablesForDesign('scope_x', [tbl('scope_x', 'x9', 'nine')])
    expect(() =>
      replaceTablesForDesign('scope_x', [tbl('scope_x', 'x10', 'ten'), tbl('scope_y', 'oops', 'bad')])
    ).toThrow(/설계/)
    // 롤백: 새 배치의 x10 도 없고, 기존 x9 는 살아 있다.
    expect(listTables().filter((t) => t.designId === 'scope_x').map((t) => t.id)).toEqual(['x9'])
    expect(listTables().filter((t) => t.designId === 'scope_y')).toHaveLength(1)
  })
})

describe('seedSets — 시드 세트 설계 스코프 저장', () => {
  const seedSet = (designId: string, tableName: string, rows: unknown[] = []): SeedSetRecord => ({
    designId,
    tableName,
    naturalKey: ['code'],
    ignoredColumns: ['id', 'created_at'],
    strength: 'authoritative',
    rows
  })

  it('CASE-design-030: 선언(자연키·무시 컬럼·설계에 없는 행 처리)과 행이 왕복에서 보존된다', () => {
    const rows = [
      { id: 'r1', values: { code: 'admin', name: '관리자', pw: '{{ADMIN_PASSWORD_HASH}}', memo: null } },
      { id: 'r2', values: { code: 'viewer', name: '조회자' } }
    ]
    replaceSeedSetsForDesign('seed_x', [seedSet('seed_x', 'roles', rows)])
    const got = listSeedSets().filter((s) => s.designId === 'seed_x')
    expect(got).toHaveLength(1)
    expect(got[0]).toEqual(seedSet('seed_x', 'roles', rows))
  })

  it('CASE-design-031: 대상 설계만 교체 — 다른 설계 시드 불변 + 저장 순서 유지', () => {
    replaceSeedSetsForDesign('seed_x', [seedSet('seed_x', 'roles'), seedSet('seed_x', 'permissions')])
    replaceSeedSetsForDesign('seed_y', [seedSet('seed_y', 'codes')])
    const yBefore = listSeedSets().filter((s) => s.designId === 'seed_y')

    replaceSeedSetsForDesign('seed_x', [seedSet('seed_x', 'permissions')])
    expect(listSeedSets().filter((s) => s.designId === 'seed_x').map((s) => s.tableName)).toEqual([
      'permissions'
    ])
    expect(listSeedSets().filter((s) => s.designId === 'seed_y')).toEqual(yBefore)
  })

  it('다른 설계 시드가 섞인 배치는 전체 롤백 — 부분 반영 0', () => {
    replaceSeedSetsForDesign('seed_x', [seedSet('seed_x', 'roles')])
    expect(() =>
      replaceSeedSetsForDesign('seed_x', [seedSet('seed_x', 'perms'), seedSet('seed_y', 'oops')])
    ).toThrow(/설계/)
    expect(listSeedSets().filter((s) => s.designId === 'seed_x').map((s) => s.tableName)).toEqual(['roles'])
  })

  it('설계를 지우면 그 설계 시드도 함께 사라진다(유령 시드 방지)', () => {
    const d = createDesign({ name: 'Seed 정리 대상', dialect: 'mysql' })
    replaceSeedSetsForDesign(d.id, [seedSet(d.id, 'roles')])
    expect(listSeedSets().filter((s) => s.designId === d.id)).toHaveLength(1)
    deleteDesign(d.id)
    expect(listSeedSets().filter((s) => s.designId === d.id)).toEqual([])
  })
})

describe('versions (컷 · 조회 · 삭제)', () => {
  it('생성→목록(최신순)→삭제(잘못 컷된 버전 회수)', () => {
    const d = 'design_ver'
    createVersion({ designId: d, number: 'v0.1.0', note: '첫', snapshot: { tables: [] } })
    const bad = createVersion({ designId: d, number: 'v0.0.1', note: '잘못 컷', snapshot: { tables: [{ id: 't:x' }] } })
    expect(listVersions(d).map((v) => v.number)).toContain('v0.0.1')

    deleteVersion(bad.id)
    const after = listVersions(d)
    expect(after.map((v) => v.number)).not.toContain('v0.0.1')
    expect(after.map((v) => v.number)).toContain('v0.1.0') // 다른 버전은 보존

    // 없는 id 삭제해도 안전(멱등).
    expect(() => deleteVersion(bad.id)).not.toThrow()
  })
})

describe('diagramLayouts (Remote 실 ERD 레이아웃 영속)', () => {
  const CONN2 = 'conn_diagram'

  it('미저장이면 null', () => {
    expect(getLayout(CONN2)).toBeNull()
  })

  it('저장 → 위치/뷰포트 JSON 왕복', () => {
    const rec = saveLayout({
      connectionId: CONN2,
      positions: { 't:users': { x: 10, y: 20 }, 't:orders': { x: 300, y: 40 } },
      viewport: { x: -5, y: 12, zoom: 1.25 }
    })
    expect(rec.connectionId).toBe(CONN2)
    const got = getLayout(CONN2)
    expect(got?.positions['t:users']).toEqual({ x: 10, y: 20 })
    expect(got?.positions['t:orders']).toEqual({ x: 300, y: 40 })
    expect(got?.viewport).toEqual({ x: -5, y: 12, zoom: 1.25 })
  })

  it('재저장은 UPSERT — 행이 늘지 않고 덮어쓴다. 미지정 항목은 그대로 둔다', () => {
    saveLayout({ connectionId: CONN2, positions: { 't:users': { x: 99, y: 99 } } })
    const got = getLayout(CONN2)
    expect(got?.positions).toEqual({ 't:users': { x: 99, y: 99 } })
    // ⚠ viewport 미지정 = "그대로 둠". 캔버스(위치·뷰포트)와 그룹 패널(그룹)이 같은 행에
    //    따로 쓰므로, 안 넘긴 항목을 지우면 서로의 저장을 날린다.
    expect(got?.viewport).toEqual({ x: -5, y: 12, zoom: 1.25 })
  })

  it('viewport 를 null 로 명시하면 지운다(자동 배치)', () => {
    saveLayout({ connectionId: CONN2, viewport: null })
    expect(getLayout(CONN2)?.viewport).toBeNull()
    // 위치는 안 넘겼으니 그대로
    expect(getLayout(CONN2)?.positions).toEqual({ 't:users': { x: 99, y: 99 } })
  })

  it('연결별 격리 — 다른 연결 레이아웃에 영향 없음', () => {
    saveLayout({ connectionId: 'conn_other', positions: { 't:x': { x: 1, y: 1 } } })
    expect(getLayout(CONN2)?.positions).toEqual({ 't:users': { x: 99, y: 99 } })
  })

  // CASE-remote-05D — 그룹 영속 왕복
  it('그룹(이름·색·소속·접힘)이 왕복한다. 그룹 열이 없던 옛 행은 빈 목록으로 읽힌다', () => {
    // 그룹 없이 저장된 기존 행 → 빈 목록
    expect(getLayout(CONN2)?.groups).toEqual([])

    const groups = [
      { id: 'g1', name: '주문', color: 'rose', tableIds: ['t:users', 't:orders'], collapsed: false, x: 10, y: 20 },
      { id: 'g2', name: '', color: '', tableIds: [], collapsed: true, x: 0, y: 0 }
    ]
    saveLayout({ connectionId: CONN2, groups })
    expect(getLayout(CONN2)?.groups).toEqual(groups)
    // 그룹만 저장했으니 위치는 그대로
    expect(getLayout(CONN2)?.positions).toEqual({ 't:users': { x: 99, y: 99 } })
  })

  it('위치만 저장해도 그룹은 안 지워진다(캔버스·패널 동시 쓰기)', () => {
    saveLayout({ connectionId: CONN2, positions: { 't:users': { x: 7, y: 7 } } })
    expect(getLayout(CONN2)?.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
  })

  it('자동 배치(clearLayout)는 배치만 지우고 그룹은 남긴다', () => {
    clearLayout(CONN2)
    const got = getLayout(CONN2)
    expect(got?.positions).toEqual({})
    expect(got?.viewport).toBeNull()
    expect(got?.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
  })

  it('남길 그룹이 없으면 clearLayout 이 행을 지운다 → null', () => {
    saveLayout({ connectionId: CONN2, groups: [] })
    clearLayout(CONN2)
    expect(getLayout(CONN2)).toBeNull()
  })
})
