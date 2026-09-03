import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toLibNodes, useCollectionStore } from './store'
import { useRemoteStore } from '../store'

/**
 * Collection 스토어의 트리 노드 매핑(folders+queries → LibNode) 검증 — 순수.
 * 폴더는 parentId, 쿼리는 folderId 를 부모로, kind 를 부여한다.
 */
describe('toLibNodes', () => {
  it('folders/queries 를 LibNode 로 매핑', () => {
    const nodes = toLibNodes(
      [{ id: 'f1', connectionId: 'c', designId: '', parentId: null, name: 'F', sortOrder: 0 }],
      [{ id: 'q1', connectionId: 'c', designId: '', folderId: 'f1', name: 'Q', description: '', sql: 'SELECT 1', sortOrder: 1 }]
    )
    expect(nodes).toEqual([
      { id: 'f1', parentId: null, kind: 'folder', name: 'F', sortOrder: 0 },
      { id: 'q1', parentId: 'f1', kind: 'query', name: 'Q', sql: 'SELECT 1', sortOrder: 1 }
    ])
  })
})

/**
 * 회귀(2026-08-12 유실 사고) — 자동저장이 저장소만 고치고 손에 든 트리 사본은 그대로 두면,
 * 그 쿼리를 다시 열 때 낡은 글이 편집기에 실리고 그게 저장소를 덮었다.
 */
describe('saveQuerySql', () => {
  it('저장소에 쓰고, 트리 사본의 sql 도 같은 값으로 맞춘다', async () => {
    const updateQuery = vi.fn(async () => {})
    ;(globalThis as unknown as { window: unknown }).window = { rockury: { savedQueries: { updateQuery } } }
    useCollectionStore.setState({
      queries: [
        { id: 'q1', connectionId: 'c', designId: '', folderId: null, name: 'Q1', description: '', sql: '', sortOrder: 0 },
        { id: 'q2', connectionId: 'c', designId: '', folderId: null, name: 'Q2', description: '', sql: '옛글', sortOrder: 1 }
      ]
    })

    await useCollectionStore.getState().saveQuerySql('q1', 'SELECT 1')

    expect(updateQuery).toHaveBeenCalledWith('q1', { sql: 'SELECT 1' })
    const qs = useCollectionStore.getState().queries
    expect(qs.find((q) => q.id === 'q1')?.sql).toBe('SELECT 1')
    // 남의 것은 안 건드린다.
    expect(qs.find((q) => q.id === 'q2')?.sql).toBe('옛글')
  })
})

/**
 * 회귀(2026-09-03 사용자 지적): 컬렉션을 일괄 실행해 DDL 이 나가도 표 목록이 옛것이었다.
 * Query 탭은 고쳤는데 여기가 빠져 있으면 **어디서 돌렸느냐**에 따라 화면이 또 다르게 군다.
 *
 * 이 트랜잭션은 커밋 전까지 원자적이라, 언제 다시 읽는지가 관심사다:
 * 실행만 한 시점엔 안 읽고, 커밋·롤백·실패로 **결판이 난 뒤**에 읽는다.
 * (롤백에도 읽는 이유: MySQL 은 DDL 을 못 되돌려 구조가 바뀐 채 남는다.)
 */
describe('Collection 일괄 실행 뒤 역설계 재조회', () => {
  const q = {
    txBegin: vi.fn(async () => ({ txId: 'tx1', dbType: 'mysql' })),
    txExec: vi.fn(async () => ({ columns: [], rows: [], rowCount: 0, affectedRows: 1, executionTimeMs: 1 })),
    txCommit: vi.fn(async () => {}),
    txRollback: vi.fn(async () => {}),
    historyAppend: vi.fn(async () => ({}))
  }
  const load = vi.fn(async () => {})
  const item = (id: string, sql: string) => ({ id, collectionId: 'k1', savedQueryId: null, name: id, sql, sortOrder: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { window: unknown }).window = { rockury: { query: q } }
    useRemoteStore.setState({ load })
    useCollectionStore.setState({
      connectionId: 'c1',
      collections: [],
      activeCollectionId: null,
      items: [],
      itemStatus: {},
      results: {},
      tx: null,
      error: null,
      info: null,
      running: false,
      aborting: false
    })
  })

  it('실행만 한 시점엔 안 읽는다 — 아직 커밋 전이라 결판이 안 났다', async () => {
    useCollectionStore.setState({ items: [item('i1', 'CREATE TABLE t (id int)')] })
    await useCollectionStore.getState().runAll()
    expect(useCollectionStore.getState().tx).toMatchObject({ hadDdl: true })
    expect(load).not.toHaveBeenCalled()
  })

  it('⭐ 커밋하면 읽는다', async () => {
    useCollectionStore.setState({ items: [item('i1', 'CREATE TABLE t (id int)')] })
    await useCollectionStore.getState().runAll()
    await useCollectionStore.getState().confirm()
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('⭐ 되돌려도 읽는다 — MySQL 은 DDL 을 못 되돌린다', async () => {
    useCollectionStore.setState({ items: [item('i1', 'DROP TABLE t')] })
    await useCollectionStore.getState().runAll()
    await useCollectionStore.getState().rollback()
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('DDL 이 없으면 커밋해도 안 읽는다 — 구조는 그대로다', async () => {
    useCollectionStore.setState({ items: [item('i1', 'UPDATE t SET a=1 WHERE id=1')] })
    await useCollectionStore.getState().runAll()
    await useCollectionStore.getState().confirm()
    expect(load).not.toHaveBeenCalled()
  })

  it('⭐ 중간에 깨져도 읽는다 — 앞 아이템의 DDL 은 이미 나갔다', async () => {
    q.txExec.mockImplementationOnce(async () => ({ columns: [], rows: [], rowCount: 0, affectedRows: 0, executionTimeMs: 1 }))
    q.txExec.mockImplementationOnce(async () => { throw new Error('문법 오류') })
    useCollectionStore.setState({
      items: [item('i1', 'CREATE TABLE a (id int)'), item('i2', 'CREATE TABLE b (bad')]
    })
    await useCollectionStore.getState().runAll()
    expect(useCollectionStore.getState().error).toBe('문법 오류')
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('아직 안 나간 아이템의 DDL 은 세지 않는다 — 첫 아이템에서 깨지면 읽을 것이 없다', async () => {
    q.txExec.mockImplementationOnce(async () => { throw new Error('권한 없음') })
    useCollectionStore.setState({
      items: [item('i1', 'UPDATE t SET a=1 WHERE id=1'), item('i2', 'DROP TABLE t')]
    })
    await useCollectionStore.getState().runAll()
    expect(load).not.toHaveBeenCalled()
  })

  it('⭐ 하나씩 실행(runOne)도 열린 트랜잭션의 판정을 물려받는다', async () => {
    useCollectionStore.setState({ items: [item('i1', 'ALTER TABLE t ADD COLUMN c text'), item('i2', 'UPDATE t SET c=1 WHERE id=1')] })
    await useCollectionStore.getState().runOne('i1')
    expect(useCollectionStore.getState().tx).toMatchObject({ hadDdl: true })
    await useCollectionStore.getState().runOne('i2')
    // 뒤 아이템은 DML 이지만 앞의 DDL 판정이 살아 있어야 커밋 때 다시 읽힌다.
    expect(useCollectionStore.getState().tx).toMatchObject({ hadDdl: true })
    expect(load).not.toHaveBeenCalled()
    await useCollectionStore.getState().confirm()
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })
})

