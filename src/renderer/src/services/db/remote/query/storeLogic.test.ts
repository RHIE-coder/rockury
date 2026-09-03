import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQueryStore } from './store'
import { useRemoteStore } from '../store'

/**
 * Query 스토어 실행 라우팅 검증 — classify 결과에 따라 read/dml/ddl 로 분기하는지.
 * window.rockury.query 를 mock 해 어떤 IPC 가 불리는지로 확인(순수 오케스트레이션).
 */
const q = {
  run: vi.fn(async () => ({ columns: ['a'], rows: [{ a: 1 }], rowCount: 1, affectedRows: undefined, executionTimeMs: 1 })),
  txBegin: vi.fn(async () => ({ txId: 'tx1', dbType: 'mysql' })),
  txExec: vi.fn(async () => ({ columns: [], rows: [], rowCount: 0, affectedRows: 3, executionTimeMs: 1 })),
  txCommit: vi.fn(async () => {}),
  txRollback: vi.fn(async () => {}),
  historyAppend: vi.fn(async () => ({})),
  historyList: vi.fn(async () => [])
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = { rockury: { query: q } }
  useQueryStore.setState({ sql: '', result: null, tx: null, ddlWarning: false, error: null, loading: false })
})

describe('run 라우팅', () => {
  it('read(SELECT) → query.run, 결과 세팅, tx 없음, 히스토리 기록', async () => {
    useQueryStore.setState({ sql: 'SELECT 1' })
    await useQueryStore.getState().run('c1')
    expect(q.run).toHaveBeenCalledWith('c1', 'SELECT 1')
    expect(q.txBegin).not.toHaveBeenCalled()
    expect(useQueryStore.getState().tx).toBeNull()
    expect(q.historyAppend).toHaveBeenCalledTimes(1)
  })

  it('dml(UPDATE, WHERE 없음) → tx 게이트(begin+exec), tx 상태 destructive, 히스토리는 아직 기록 안 함', async () => {
    useQueryStore.setState({ sql: 'UPDATE t SET a=1' })
    await useQueryStore.getState().run('c1')
    expect(q.txBegin).toHaveBeenCalledWith('c1')
    expect(q.txExec).toHaveBeenCalledWith('tx1', 'UPDATE t SET a=1')
    const tx = useQueryStore.getState().tx
    expect(tx).toMatchObject({ txId: 'tx1', verb: 'UPDATE', affectedRows: 3, destructive: true })
    expect(q.historyAppend).not.toHaveBeenCalled()
  })

  it('ddl(CREATE) → query.run + 자동커밋 경고', async () => {
    useQueryStore.setState({ sql: 'CREATE TABLE t (id int)' })
    await useQueryStore.getState().run('c1')
    expect(q.run).toHaveBeenCalled()
    expect(useQueryStore.getState().ddlWarning).toBe(true)
  })

  it('빈 SQL → 실행 안 함, 에러 메시지', async () => {
    useQueryStore.setState({ sql: '   ' })
    await useQueryStore.getState().run('c1')
    expect(q.run).not.toHaveBeenCalled()
    expect(useQueryStore.getState().error).toBeTruthy()
  })

  it('dml 커밋 → txCommit + 히스토리 기록', async () => {
    useQueryStore.setState({ sql: 'DELETE FROM t WHERE id=1', lastConn: 'c1', tx: { txId: 'tx1', verb: 'DELETE', affectedRows: 1, destructive: false, hadDdl: false } })
    await useQueryStore.getState().confirm()
    expect(q.txCommit).toHaveBeenCalledWith('tx1')
    expect(q.historyAppend).toHaveBeenCalledTimes(1)
    expect(useQueryStore.getState().tx).toBeNull()
  })
})

/**
 * 회귀(2026-09-03 사용자 지적): Query 탭에서 `ALTER TABLE` 을 쳐도 Data 의 표 목록이 옛것이었다.
 * Definition 의 스키마 편집만 재역설계를 부르고 Query 는 안 불러서, **같은 DDL 을 어디서 쳤느냐에
 * 따라** 화면이 다르게 굴었다. 여기서 보는 것은 "역설계를 다시 읽으라고 시켰는가" 하나다.
 */
describe('DDL 실행 뒤 역설계 재조회', () => {
  const load = vi.fn(async () => {})
  beforeEach(() => {
    load.mockClear()
    useRemoteStore.setState({ load })
  })

  it('DDL(CREATE) → 강제 재조회를 부른다', async () => {
    useQueryStore.setState({ sql: 'CREATE TABLE t (id int)' })
    await useQueryStore.getState().run('c1')
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('읽기(SELECT) → 부르지 않는다 — 구조는 그대로다', async () => {
    useQueryStore.setState({ sql: 'SELECT 1' })
    await useQueryStore.getState().run('c1')
    expect(load).not.toHaveBeenCalled()
  })

  it('DML 만이면 부르지 않는다 — 커밋해도 마찬가지', async () => {
    useQueryStore.setState({ sql: 'UPDATE t SET a=1 WHERE id=1' })
    await useQueryStore.getState().run('c1')
    await useQueryStore.getState().confirm()
    expect(load).not.toHaveBeenCalled()
  })

  it('⭐ DDL+DML 섞인 스크립트 → 게이트를 여는 동안은 안 부르고, 커밋한 뒤에 부른다', async () => {
    useQueryStore.setState({ sql: 'ALTER TABLE t ADD COLUMN c text; UPDATE t SET c = 1' })
    await useQueryStore.getState().run('c1')
    expect(useQueryStore.getState().tx).toMatchObject({ hadDdl: true })
    expect(load).not.toHaveBeenCalled()
    await useQueryStore.getState().confirm()
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('⭐ 섞인 스크립트를 되돌려도 부른다 — MySQL 은 DDL 을 못 되돌린다', async () => {
    useQueryStore.setState({ sql: 'ALTER TABLE t ADD COLUMN c text; UPDATE t SET c = 1' })
    await useQueryStore.getState().run('c1')
    load.mockClear()
    await useQueryStore.getState().rollback()
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })

  it('⭐ DDL 이 실패해도 부른다 — 앞 문이 이미 나갔을 수 있다', async () => {
    q.run.mockRejectedValueOnce(new Error('boom'))
    useQueryStore.setState({ sql: 'CREATE TABLE a (id int); CREATE TABLE b (bad' })
    await useQueryStore.getState().run('c1')
    expect(useQueryStore.getState().error).toBe('boom')
    expect(load).toHaveBeenCalledWith('c1', 'c1', true)
  })
})
