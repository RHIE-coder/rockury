import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMigrationStore, type SnapshotSummary } from './store'
import { useVersionsStore } from '../versions/store'
import type { Diagnosis } from './diagnose'

/**
 * Migration 스토어 오케스트레이션 검증 — 맵핑(판정·못박기)·진단·계획·실행이 올바른 IPC 를
 * 부르고 올바른 순서로 움직이는지. `window.rockury` 를 mock 한다.
 * 순수 계산부(identify/diagnose/revert/ddlDiff)는 각자의 테스트가 담당한다.
 */

/** 기준선 본문 응답(preload SnapshotRecord 와 같은 모양) — mock 이 null 로 굳지 않게 명시한다. */
type SnapshotResponse = {
  id: string
  envId: string
  version: string
  snapshot: unknown
  checksum: string
  scope: string[]
  createdAt: string
}

type EnvResponse = {
  id: string
  connectionId: string
  designId: string
  targetVersion: string
  appliedVersion: string | null
  createdAt: string
  updatedAt: string
}

/** 역설계 응답 — `schemas` 는 **실제로 읽은 범위**라 스냅샷의 scope 가 여기서 온다. */
const introspected = (schemas: string[] = [], tableName = 't'): Record<string, unknown> => ({
  dialect: 'mysql',
  schemas,
  tables: [{ name: tableName, comment: '' }],
  columns: [{ table: tableName, name: 'id', type: 'int', nullable: false, default: null, comment: '', ordinal: 1 }],
  keys: [],
  foreignKeys: []
})

const env = (over: Partial<EnvResponse> = {}): EnvResponse => ({
  id: 'env1',
  connectionId: 'c1',
  designId: 'd1',
  targetVersion: '',
  appliedVersion: null,
  createdAt: '',
  updatedAt: '',
  ...over
})

const api = {
  introspection: { run: vi.fn(async () => introspected()) },
  environments: {
    ensure: vi.fn(async (): Promise<EnvResponse> => env()),
    setApplied: vi.fn(async () => ({}))
  },
  migration: {
    latestSnapshot: vi.fn(async (): Promise<SnapshotResponse | null> => null),
    listSnapshots: vi.fn(async (): Promise<SnapshotSummary[]> => []),
    saveSnapshot: vi.fn(async (_input: { envId: string; version: string; snapshot: unknown; scope?: string[] }) => ({})),
    appendLog: vi.fn(async (_input: { envId: string; kind: string; summary?: string; detail?: string }) => ({})),
    listLogs: vi.fn(async () => [])
  },
  versions: { list: vi.fn(async () => []) },
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
  useMigrationStore.setState({
    binding: null, actual: null, actualScope: [], remoteVersion: '', identified: null,
    diagnosis: null, targetVersion: null, hasBaseline: false, baselineAt: '', baselineScope: [],
    scopeChanged: false, snapshots: [], plan: null, planDiff: null, revert: null, tx: null,
    interrupted: null, logs: [], driftAck: false, destructiveAck: false, error: null
  })
  // 버전 목록은 이미 실려 있는 것으로 둔다 — 안 그러면 ensureLoaded 가 IPC 를 찾아 나선다.
  useVersionsStore.setState({ byDesign: { d1: [] }, loaded: { d1: true } })
})

/**
 * 계획 시점의 실제를 **mock 역설계 결과와 같게** 맞춘다.
 * 이걸 안 하면 밀기 직전 재확인이 "그 사이 남이 바꿨다"고 판단해 한 문도 안 나간다.
 */
async function primeActual(): Promise<void> {
  await useMigrationStore.getState().introspectActual('c1', 'd1')
}

/** 드리프트가 "있는" 진단 — 테이블 하나가 늘어난 상태. */
const drifted: Diagnosis = {
  ahead: null,
  drift: {
    tables: [{ id: 't:x', name: 'x', status: 'added', tableChanges: [], columns: [], constraints: [] }],
    summary: {
      tablesAdded: 1, tablesRemoved: 0, tablesModified: 0,
      columnsAdded: 0, columnsRemoved: 0, columnsModified: 0,
      constraintsAdded: 0, constraintsRemoved: 0, constraintsModified: 0
    }
  }
}

describe('맵핑 — 판정은 읽기만 한다', () => {
  it('identify 는 실제를 떠서 버전과 대조할 뿐, 아무것도 저장하지 않는다', async () => {
    useVersionsStore.setState({
      byDesign: { d1: [{ id: 'd1@v1', designId: 'd1', number: 'v1', note: '', snapshot: { tables: [] }, locked: false, createdAt: '' }] },
      loaded: { d1: true }
    })

    await useMigrationStore.getState().identify('c1', 'd1')

    expect(api.introspection.run).toHaveBeenCalledWith('c1')
    expect(useMigrationStore.getState().identified).not.toBeNull()
    // 판정은 쓰지 않는다 — 못박기(confirmMapping)와 가져오기의 몫이다.
    expect(api.environments.setApplied).not.toHaveBeenCalled()
    expect(api.migration.saveSnapshot).not.toHaveBeenCalled()
  })

  it('confirmMapping 은 버전을 못박고 그 순간을 기준선으로 남긴다', async () => {
    await useMigrationStore.getState().confirmMapping('c1', 'd1', 'v0.1.0')

    expect(api.environments.setApplied).toHaveBeenCalledWith('env1', 'v0.1.0')
    expect(api.migration.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ envId: 'env1', version: 'v0.1.0' })
    )
    expect(api.migration.appendLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'map', toVersion: 'v0.1.0' }))
  })

  it('맵핑 직후 기준선이 남아야 첫 진단에서 드리프트를 말할 수 있다', async () => {
    await useMigrationStore.getState().confirmMapping('c1', 'd1', 'v0.1.0')

    const saveAt = api.migration.saveSnapshot.mock.invocationCallOrder[0]
    const appliedAt = api.environments.setApplied.mock.invocationCallOrder[0]
    expect(saveAt).toBeGreaterThan(appliedAt) // 버전을 정한 뒤에 그 버전으로 기준선을 찍는다
  })
})

describe('진단', () => {
  it('Remote 버전을 모르면 앞선 것을 못 잰다 — 맵핑이 먼저다', async () => {
    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().remoteVersion).toBe('')
    expect(useMigrationStore.getState().diagnosis?.ahead).toBeNull()
  })

  it('기준선이 있으면 이력도 함께 싣는다', async () => {
    api.environments.ensure.mockResolvedValueOnce(env({ appliedVersion: 'v1' }))
    api.migration.latestSnapshot.mockResolvedValueOnce({
      id: 'snap1', envId: 'env1', version: 'v1', snapshot: { tables: [] },
      checksum: 'c', scope: [], createdAt: '2026-08-10T04:48:25.707Z'
    })
    api.migration.listSnapshots.mockResolvedValueOnce([
      { id: 'snap1', envId: 'env1', version: 'v1', tableCount: 2, checksum: 'c', scope: [], createdAt: '2026-08-10T04:48:25.707Z' }
    ])

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    const st = useMigrationStore.getState()
    expect(st.remoteVersion).toBe('v1')
    expect(st.baselineAt).toBe('2026-08-10T04:48:25.707Z')
    expect(st.snapshots).toHaveLength(1)
  })

  it('타깃을 안 주면 설계의 최신 버전으로 간다 — "설계의 지금"이 곧 밀고 싶은 것이다', async () => {
    useVersionsStore.setState({
      byDesign: {
        d1: [
          { id: 'a', designId: 'd1', number: 'v0.1.0', note: '', snapshot: { tables: [] }, locked: true, createdAt: '' },
          { id: 'b', designId: 'd1', number: 'v0.2.0', note: '', snapshot: { tables: [] }, locked: false, createdAt: '' }
        ]
      },
      loaded: { d1: true }
    })

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().targetVersion).toBe('v0.2.0')
  })
})

describe('범위가 바뀌면 알린다', () => {
  it('기준선을 찍은 범위와 방금 읽은 범위가 다르면 scopeChanged', async () => {
    api.introspection.run.mockResolvedValueOnce(introspected(['testdb']))
    api.migration.latestSnapshot.mockResolvedValueOnce({
      id: 'snap1', envId: 'env1', version: 'v1', snapshot: { tables: [] },
      checksum: 'c', scope: ['service1'], createdAt: '2026-08-10T04:48:25.707Z'
    })

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().scopeChanged).toBe(true)
    expect(useMigrationStore.getState().baselineScope).toEqual(['service1'])
  })

  it('순서만 다른 같은 범위는 바뀐 것이 아니다', async () => {
    api.introspection.run.mockResolvedValueOnce(introspected(['b', 'a']))
    api.migration.latestSnapshot.mockResolvedValueOnce({
      id: 'snap1', envId: 'env1', version: 'v1', snapshot: { tables: [] },
      checksum: 'c', scope: ['a', 'b'], createdAt: '2026-08-10T04:48:25.707Z'
    })

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().scopeChanged).toBe(false)
  })

  it('범위를 안 남긴 예전 스냅샷은 "다르다"고 단정하지 않는다', async () => {
    api.introspection.run.mockResolvedValueOnce(introspected(['testdb']))
    api.migration.latestSnapshot.mockResolvedValueOnce({
      id: 'snap1', envId: 'env1', version: 'v1', snapshot: { tables: [] },
      checksum: 'c', scope: [], createdAt: '2026-08-10T04:48:25.707Z'
    })

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().scopeChanged).toBe(false)
  })

  it('기준선 캡처는 실제로 읽은 범위를 스냅샷에 적는다', async () => {
    api.introspection.run.mockResolvedValueOnce(introspected(['service1']))
    useMigrationStore.setState({ binding: { id: 'env1', targetVersion: '', appliedVersion: null } })

    await useMigrationStore.getState().captureBaseline('c1', 'd1', '')

    expect(api.migration.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ scope: ['service1'] }))
  })
})

describe('기준선 갱신은 덮기 전에 무엇이 달랐는지 남긴다', () => {
  it('드리프트가 있으면 drift 로그를 먼저 쓰고 그 다음에 스냅샷을 덮는다', async () => {
    // Remote 버전은 바인딩에서 다시 읽어 오므로(최신이 맞다) mock 쪽에 심는다.
    api.environments.ensure.mockResolvedValueOnce(env({ appliedVersion: 'v1' }))
    useMigrationStore.setState({
      binding: { id: 'env1', targetVersion: '', appliedVersion: 'v1' },
      actual: { tables: [] },
      diagnosis: drifted
    })

    await useMigrationStore.getState().captureBaseline('c1', 'd1', 'v2')

    expect(api.migration.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'drift', fromVersion: 'v1', toVersion: 'v2', summary: '테이블 추가 1개', detail: '+x' })
    )
    // 기록이 저장보다 먼저여야 한다 — 반대면 덮은 뒤에 적는 셈이라 실패 시 사실이 사라진다.
    expect(api.migration.appendLog.mock.invocationCallOrder[0]).toBeLessThan(
      api.migration.saveSnapshot.mock.invocationCallOrder[0]
    )
  })

  it('드리프트가 없으면 drift 로그를 남기지 않는다 — 남길 사실이 없다', async () => {
    useMigrationStore.setState({
      binding: { id: 'env1', targetVersion: '', appliedVersion: null },
      actual: { tables: [] },
      diagnosis: { ahead: null, drift: null }
    })

    await useMigrationStore.getState().captureBaseline('c1', 'd1', 'v1')

    const kinds = api.migration.appendLog.mock.calls.map((c) => c[0].kind)
    expect(kinds).not.toContain('drift')
    expect(kinds).toContain('baseline')
  })
})

describe('반영 전 드리프트 차단', () => {
  const planned = {
    binding: { id: 'env1', targetVersion: 'v1', appliedVersion: null },
    targetVersion: 'v1',
    plan: { statements: [{ sql: 'DROP TABLE `x`;', kind: 'drop' as const, destructive: true, table: 'x' }], destructiveCount: 1, unsupported: [] }
  }

  it('드리프트가 있는데 승인 안 했으면 실행하지 않는다 — 남의 변경이 덮이는 자리', async () => {
    await primeActual()
    useMigrationStore.setState({ ...planned, hasBaseline: true, diagnosis: drifted, driftAck: false })

    await useMigrationStore.getState().run('c1', 'd1')

    expect(api.query.txBegin).not.toHaveBeenCalled()
    expect(useMigrationStore.getState().error).toContain('기준선과 다릅니다')
  })

  it('승인했으면 실행한다', async () => {
    await primeActual()
    useMigrationStore.setState({ ...planned, hasBaseline: true, diagnosis: drifted, driftAck: true })

    await useMigrationStore.getState().run('c1', 'd1')

    expect(api.query.txBegin).toHaveBeenCalledWith('c1')
    expect(useMigrationStore.getState().tx).not.toBeNull()
  })

  it('기준선이 없으면 막지 않는다 — 견줄 대상이 없으니 드리프트라 부를 것도 없다', async () => {
    await primeActual()
    useMigrationStore.setState({ ...planned, hasBaseline: false, diagnosis: drifted, driftAck: false })

    await useMigrationStore.getState().run('c1', 'd1')

    expect(api.query.txBegin).toHaveBeenCalledWith('c1')
  })
})

describe('밀기 직전 재확인 — 계획을 세운 뒤 남이 바꿨나', () => {
  const planned = {
    binding: { id: 'env1', targetVersion: 'v1', appliedVersion: null },
    targetVersion: 'v1',
    plan: { statements: [{ sql: 'CREATE TABLE `y` (id INT);', kind: 'create' as const, destructive: false, table: 'y' }], destructiveCount: 0, unsupported: [] }
  }

  it('그 사이 바뀌었으면 한 문도 실행하지 않고 멈춘다', async () => {
    // 계획을 세울 때 본 실제와 다른 것이 지금 읽힌다.
    useMigrationStore.setState({ ...planned, actual: { tables: [] } })
    api.introspection.run.mockResolvedValueOnce(introspected([], 'sneaky'))

    await useMigrationStore.getState().run('c1', 'd1')

    expect(api.query.txBegin).not.toHaveBeenCalled()
    expect(useMigrationStore.getState().interrupted?.at).toBe(0)
    // 낡은 계획은 버린다 — 남겨 두면 다시 누를 수 있다.
    expect(useMigrationStore.getState().plan).toBeNull()
  })

  it('그대로면 그냥 민다', async () => {
    await primeActual()
    useMigrationStore.setState(planned)

    await useMigrationStore.getState().run('c1', 'd1')

    expect(api.query.txBegin).toHaveBeenCalledWith('c1')
    expect(useMigrationStore.getState().interrupted).toBeNull()
  })
})

describe('run → confirm 시퀀스', () => {
  it('confirm 은 커밋 + 스냅샷 + Remote 버전 갱신 + 로그', async () => {
    useVersionsStore.setState({
      byDesign: { d1: [{ id: 'd1@v1', designId: 'd1', number: 'v1', note: '', snapshot: { tables: [] }, locked: false, createdAt: '' }] },
      loaded: { d1: true }
    })
    await primeActual()
    useMigrationStore.setState({
      binding: { id: 'env1', targetVersion: 'v1', appliedVersion: null },
      targetVersion: 'v1',
      remoteVersion: '',
      plan: { statements: [{ sql: 'ALTER TABLE `t` ADD COLUMN `x` int NULL;', kind: 'alter', destructive: false, table: 't' }], destructiveCount: 0, unsupported: [] }
    })

    await useMigrationStore.getState().run('c1', 'd1')
    expect(api.query.txExec).toHaveBeenCalledWith('tx1', 'ALTER TABLE `t` ADD COLUMN `x` int NULL;')

    await useMigrationStore.getState().confirm('c1', 'd1')
    expect(api.query.txCommit).toHaveBeenCalledWith('tx1')
    expect(api.migration.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ envId: 'env1', version: 'v1' }))
    expect(api.environments.setApplied).toHaveBeenCalledWith('env1', 'v1')
    expect(api.migration.appendLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'apply', toVersion: 'v1' }))
    expect(useMigrationStore.getState().tx).toBeNull()
  })
})
