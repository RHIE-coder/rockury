import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMigrationStore } from './store'
import { useVersionsStore } from '../versions/store'

/**
 * Migration 스토어 오케스트레이션 검증 — 맵핑(판정·못박기)·진단·계획·실행이 올바른 IPC 를
 * 부르고 올바른 순서로 움직이는지. `window.rockury` 를 mock 한다.
 * 순수 계산부(identify/diagnose/revert/ddlDiff)는 각자의 테스트가 담당한다.
 */

type EnvResponse = {
  id: string
  connectionId: string
  designId: string
  targetVersion: string
  appliedVersion: string | null
  createdAt: string
  updatedAt: string
}

/** 역설계 응답 — `schemas` 는 **실제로 읽은 범위**다. */
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
    diagnosis: null, diagTarget: null, diagDiff: null, targetVersion: null,
    plan: null, planDiff: null, revert: null, tx: null, removalsPassed: null,
    interrupted: null, logs: [], destructiveAck: false, error: null
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
  })

  it('confirmMapping 은 버전을 못박고 그 사실을 이력에 남긴다', async () => {
    await useMigrationStore.getState().confirmMapping('c1', 'd1', 'v0.1.0')

    expect(api.environments.setApplied).toHaveBeenCalledWith('env1', 'v0.1.0')
    expect(api.migration.appendLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'map', toVersion: 'v0.1.0' }))
  })

})

describe('결속 갈아타기 — 앞 연결의 계획을 새 연결로 들고 가지 않는다', () => {
  /*
   * 회귀(2026-08-17): 짝이 바뀔 때 승인(`removalsPassed`)만 풀고 계획은 남겼다. 실행 화면은
   * 스토어의 계획을 그대로 그리고 밀기는 **화면이 준 연결 id** 로 나가므로, 앞 연결에서 만든
   * 문들이 새 연결로 나갈 수 있었다.
   */
  it('짝이 바뀌면 계획·되돌리기·동의를 다 버린다', async () => {
    useMigrationStore.setState({
      binding: { id: 'env1', targetVersion: 'v1', appliedVersion: 'v1' },
      removalsPassed: 'orders',
      destructiveAck: true,
      plan: { statements: [{ sql: 'DROP TABLE `t`;', kind: 'drop', destructive: true, table: 't' }], destructiveCount: 1, unsupported: [] },
      revert: { statements: [], lossy: [], destructiveCount: 0, unsupported: [] }
    })
    api.environments.ensure.mockResolvedValueOnce(env({ id: 'env2', connectionId: 'c2' }))

    await useMigrationStore.getState().resolveBinding('c2', 'd1')

    const s = useMigrationStore.getState()
    expect(s.plan).toBeNull()
    expect(s.revert).toBeNull()
    expect(s.removalsPassed).toBeNull()
    expect(s.destructiveAck).toBe(false)
  })

  it('같은 짝을 다시 읽는 것으로는 안 버린다 — 계획을 만드는 길이 이걸 거친다', async () => {
    const plan = { statements: [{ sql: 'ALTER TABLE `t` ADD COLUMN `x` int NULL;', kind: 'alter' as const, destructive: false, table: 't' }], destructiveCount: 0, unsupported: [] }
    useMigrationStore.setState({ binding: { id: 'env1', targetVersion: 'v1', appliedVersion: 'v1' }, plan })

    await useMigrationStore.getState().resolveBinding('c1', 'd1')

    expect(useMigrationStore.getState().plan).toBe(plan)
  })
})

describe('진단', () => {
  it('Remote 버전을 모르면 앞선 것을 못 잰다 — 맵핑이 먼저다', async () => {
    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().remoteVersion).toBe('')
    expect(useMigrationStore.getState().diagnosis?.ahead).toBeNull()
  })


  /**
   * 목록은 **최신순**으로 온다(`versions/store.byDesign` · 저장소가 `created_at DESC`).
   * 예전엔 이 테스트가 오래된 것부터 늘어놓아, 맨 뒤를 집는 코드가 통과해 버렸다 —
   * 그래서 실제 앱에서는 타깃이 늘 맨 처음 컷한 버전이었다(2026-08-12).
   */
  it('타깃을 안 주면 설계의 최신 버전으로 간다 — "설계의 지금"이 곧 밀고 싶은 것이다', async () => {
    useVersionsStore.setState({
      byDesign: {
        d1: [
          { id: 'b', designId: 'd1', number: 'v0.2.0', note: '', snapshot: { tables: [] }, locked: false, createdAt: '2026-08-12T00:00:00.000Z' },
          { id: 'a', designId: 'd1', number: 'v0.1.0', note: '', snapshot: { tables: [] }, locked: true, createdAt: '2026-08-11T00:00:00.000Z' }
        ]
      },
      loaded: { d1: true }
    })

    await useMigrationStore.getState().runDiagnosis('c1', 'd1')

    expect(useMigrationStore.getState().targetVersion).toBe('v0.2.0')
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
  it('confirm 은 커밋 + Remote 버전 갱신 + 로그', async () => {
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
    expect(api.environments.setApplied).toHaveBeenCalledWith('env1', 'v1')
    expect(api.migration.appendLog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'apply', toVersion: 'v1' }))
    expect(useMigrationStore.getState().tx).toBeNull()
  })
})
