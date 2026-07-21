import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQueryStore } from './store'

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
    useQueryStore.setState({ sql: 'DELETE FROM t WHERE id=1', lastConn: 'c1', tx: { txId: 'tx1', verb: 'DELETE', affectedRows: 1, destructive: false } })
    await useQueryStore.getState().confirm()
    expect(q.txCommit).toHaveBeenCalledWith('tx1')
    expect(q.historyAppend).toHaveBeenCalledTimes(1)
    expect(useQueryStore.getState().tx).toBeNull()
  })
})
