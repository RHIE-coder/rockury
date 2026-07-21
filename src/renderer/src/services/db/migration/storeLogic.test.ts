import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMigrationStore } from './store'
import { useVersionsStore } from '../versions/store'

/**
 * Migration 스토어 오케스트레이션 검증 — Connection+Design 바인딩, Drift(diff 재사용),
 * Run→Commit 시퀀스(tx 게이트 + 스냅샷 + appliedVersion + 로그)가 올바른 IPC 를 부르는지.
 * window.rockury 를 mock. 순수 계산부(diffSnapshots/generateMigration)는 별도 테스트가 담당.
 */
const api = {
  introspection: {
    run: vi.fn(async () => ({
      dialect: 'mysql',
      tables: [{ name: 't', comment: '' }],
      columns: [{ table: 't', name: 'id', type: 'int', nullable: false, default: null, comment: '', ordinal: 1 }],
      keys: [],
      foreignKeys: []
    }))
  },
  environments: {
    ensure: vi.fn(async () => ({ id: 'env1', connectionId: 'c1', designId: 'd1', targetVersion: 'v1', appliedVersion: null, createdAt: '', updatedAt: '' })),
    setApplied: vi.fn(async () => ({}))
  },
  migration: {
    latestSnapshot: vi.fn(async () => null),
    saveSnapshot: vi.fn(async () => ({})),
    appendLog: vi.fn(async () => ({})),
    listLogs: vi.fn(async () => [])
  },
  query: {
    txBegin: vi.fn(async () => ({ txId: 'tx1', dbType: 'mysql' })),
    txExec: vi.fn(async () => ({ affectedRows: 2, columns: [], rows: [], rowCount: 0, executionTimeMs: 1 })),
    txCommit: vi.fn(async () => {}),
    txRollback: vi.fn(async () => {})
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = { rockury: api }
  useMigrationStore.setState({ binding: null, actual: null, driftDiff: null, hasBaseline: false, plan: null, planDiff: null, tx: null, targetVersion: null, logs: [] })
})

describe('loadDrift', () => {
  it('기준선 없으면 바인딩 확보 + introspect + hasBaseline false', async () => {
    await useMigrationStore.getState().loadDrift('c1', 'd1')
    expect(api.environments.ensure).toHaveBeenCalledWith('c1', 'd1', '')
    expect(api.introspection.run).toHaveBeenCalledWith('c1')
    expect(useMigrationStore.getState().hasBaseline).toBe(false)
    expect(useMigrationStore.getState().driftDiff).toBeNull()
  })
})

describe('run → confirm 시퀀스', () => {
  it('run 은 tx 게이트로 문 실행, confirm 은 커밋+스냅샷+appliedVersion+로그', async () => {
    useVersionsStore.setState({
      byDesign: { d1: [{ id: 'd1@v1', designId: 'd1', number: 'v1', note: '', snapshot: { tables: [] }, locked: false, createdAt: '' }] },
      loaded: { d1: true }
    })
    useMigrationStore.setState({
      binding: { id: 'env1', targetVersion: 'v1', appliedVersion: null },
      targetVersion: 'v1',
      baselineVersion: '',
      plan: { statements: [{ sql: 'ALTER TABLE `t` ADD COLUMN `x` int NULL;', kind: 'alter', destructive: false, table: 't' }], destructiveCount: 0, unsupported: [] }
    })

    await useMigrationStore.getState().run('c1')
    expect(api.query.txBegin).toHaveBeenCalledWith('c1')
    expect(api.query.txExec).toHaveBeenCalledWith('tx1', 'ALTER TABLE `t` ADD COLUMN `x` int NULL;')
    expect(useMigrationStore.getState().tx).toMatchObject({ txId: 'tx1', affected: 2, statements: 1 })

    await useMigrationStore.getState().confirm('c1', 'd1')
    expect(api.query.txCommit).toHaveBeenCalledWith('tx1')
    expect(api.migration.saveSnapshot).toHaveBeenCalledWith({ envId: 'env1', version: 'v1', snapshot: { tables: [] } })
    expect(api.environments.setApplied).toHaveBeenCalledWith('env1', 'v1')
    expect(api.migration.appendLog).toHaveBeenCalledWith(expect.objectContaining({ envId: 'env1', kind: 'apply', toVersion: 'v1' }))
    expect(useMigrationStore.getState().tx).toBeNull()
  })
})
