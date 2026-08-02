import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 가져오기 창의 **범위 배선** 검증 — 무엇을 읽어올지(스키마·database)를 창에서 고를 수 있는가.
 *
 * 회귀 방지가 목적이다: 예전엔 범위를 안 넘기고 역설계를 불러(`run(connId)`) PostgreSQL 이
 * `current_schema()` 하나만 읽었고, 여러 스키마로 짜인 원격은 조각만 들어왔다.
 */

// window 를 **import 보다 먼저** 세운다 — 딸려 오는 스토어들이 모듈을 읽는 그 순간 init 을
// 부른다(designs·connections·seed·definition). 나중에 세우면 그 넷이 window 없이 터진다.
const api = vi.hoisted(() => {
  const ir = (schema: string) => ({
    dialect: 'postgresql',
    schemas: [schema],
    tables: [{ schema, name: 't', comment: '' }],
    columns: [
      { schema, table: 't', name: 'id', type: 'int', nullable: false, default: null, comment: '', ordinal: 1 }
    ],
    keys: [],
    foreignKeys: []
  })
  const stub = {
    introspection: {
      run: vi.fn(async () => ir('public')),
      schemas: vi.fn(async () => ['public', 'auth', 'billing']),
      catalogs: vi.fn(async () => ['app', 'analytics'])
    },
    connections: { list: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    versions: { list: vi.fn(async () => []), create: vi.fn(async (v) => ({ id: 'v1', ...v })) },
    environments: {
      ensure: vi.fn(async () => ({ id: 'env1' })),
      setApplied: vi.fn(async () => ({}))
    },
    migration: { saveSnapshot: vi.fn(async () => ({})), appendLog: vi.fn(async () => ({})) },
    connectionGroups: { list: vi.fn(async () => []) },
    designs: { list: vi.fn(async () => []) },
    seedSets: { list: vi.fn(async () => []) },
    tables: { list: vi.fn(async () => []) }
  }
  // 안 적은 IPC 는 전부 "빈 목록"으로 답한다 — 딸려 오는 스토어들이 저마다 로드 시 init 을
  // 부른다. 하나씩 적으면 남이 스토어를 하나 늘릴 때마다 이 테스트가 깨진다.
  const anyIpc = new Proxy({}, { get: () => vi.fn(async () => []) })
  const rockury = new Proxy(stub as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : anyIpc)
  })
  ;(globalThis as unknown as { window: unknown }).window = { rockury }
  return stub
})

// nav 는 통째로 가짜로 세운다 — 진짜를 태우면 서비스 레지스트리가 딸려 오고, 그 안에서
// 서비스 스토어들이 `useNav.subscribe` 를 부르는 순환 참조에 걸려 모듈 로드 자체가 터진다.
// 가져오기가 nav 를 쓰는 곳은 컷 성공 후 활성 설계를 바꾸는 한 줄뿐이다(여기선 안 탄다).
vi.mock('@renderer/nav/useNav', () => ({
  useNav: { getState: () => ({ setContextValue: vi.fn() }) }
}))

// 타입만 정적으로 가져온다(런타임에 지워져 위 hoisted 보다 먼저 실행될 일이 없다).
import type { ConnectionDef } from '../connections/store'

const { useConnectionsStore } = await import('../connections/store')
const { useImportStore } = await import('./importStore')

const conn = (over: Partial<ConnectionDef> = {}): ConnectionDef => ({
  id: 'c1',
  name: 'prod',
  dbType: 'postgresql',
  host: 'db.local',
  port: 5432,
  database: 'app',
  user: 'admin',
  sslEnabled: false,
  schemas: [],
  autoCheckDisabled: false,
  groupId: null,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  ...over
})

/** prepare 가 띄운 뒷일(목록 읽기·역설계)이 다 앉을 때까지. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionsStore.setState({ connections: [conn()] })
  useImportStore.setState({ open: false, connection: null, design: null, phase: 'idle', availableSchemas: null, catalogs: [], scopeError: null })
})

describe('범위를 명시해 역설계한다', () => {
  it('연결에 저장된 범위를 그대로 넘기고, 고를 수 있는 목록도 함께 읽는다', async () => {
    useConnectionsStore.setState({ connections: [conn({ schemas: ['public', 'auth'] })] })
    useImportStore.getState().openImport(conn({ schemas: ['public', 'auth'] }), null)
    await settle()

    expect(api.introspection.run).toHaveBeenCalledWith('c1', ['public', 'auth'])
    expect(api.introspection.schemas).toHaveBeenCalledWith('c1')
    expect(api.introspection.catalogs).toHaveBeenCalledWith('c1')
    expect(useImportStore.getState().availableSchemas).toEqual(['public', 'auth', 'billing'])
    expect(useImportStore.getState().catalogs).toEqual(['app', 'analytics'])
  })

  it('SQLite 는 고를 것이 없어 목록을 읽지 않는다', async () => {
    useImportStore.getState().openImport(conn({ dbType: 'sqlite' }), null)
    await settle()

    expect(api.introspection.schemas).not.toHaveBeenCalled()
    expect(api.introspection.catalogs).not.toHaveBeenCalled()
    expect(useImportStore.getState().availableSchemas).toEqual([])
  })

  it('MySQL 은 카탈로그 층이 없어 database 목록을 따로 읽지 않는다', async () => {
    useImportStore.getState().openImport(conn({ dbType: 'mysql' }), null)
    await settle()

    expect(api.introspection.schemas).toHaveBeenCalledWith('c1')
    expect(api.introspection.catalogs).not.toHaveBeenCalled()
  })
})

describe('setScope', () => {
  it('고른 범위를 연결에 저장하고 그 범위로 다시 읽는다', async () => {
    useImportStore.getState().openImport(conn(), null)
    await settle()
    api.introspection.run.mockClear()

    useImportStore.getState().setScope(['public', 'billing'])
    await settle()

    // 연결에 저장 — 드리프트 검사·Remote 화면이 같은 범위를 봐야 가져온 직후 어긋나지 않는다.
    expect(api.connections.update).toHaveBeenCalledWith('c1', { schemas: ['public', 'billing'] })
    expect(useConnectionsStore.getState().connections[0].schemas).toEqual(['public', 'billing'])
    // 저장이 끝나기를 기다리지 않고 새 범위로 바로 다시 읽는다.
    expect(api.introspection.run).toHaveBeenCalledWith('c1', ['public', 'billing'])
  })
})

describe('switchConnection', () => {
  it('다른 database 를 고르면 그 연결로 대상을 갈아타고 다시 읽는다', async () => {
    const other = conn({ id: 'c2', name: 'prod · analytics', database: 'analytics', schemas: ['public'] })
    useImportStore.getState().openImport(conn(), null)
    await settle()
    api.introspection.run.mockClear()

    useImportStore.getState().switchConnection(other)
    await settle()

    expect(useImportStore.getState().connection?.id).toBe('c2')
    expect(api.introspection.run).toHaveBeenCalledWith('c2', ['public'])
  })

  it('손대지 않은 새 설계 이름은 새 연결 이름을 따라간다', async () => {
    useImportStore.getState().openImport(conn(), null)
    await settle()
    const auto = useImportStore.getState().designName

    useImportStore.getState().switchConnection(conn({ id: 'c2', name: 'staging' }))
    await settle()

    expect(useImportStore.getState().designName).not.toBe(auto)
    expect(useImportStore.getState().designName).toContain('staging')
  })

  it('직접 적은 설계 이름은 연결을 갈아타도 그대로 둔다', async () => {
    useImportStore.getState().openImport(conn(), null)
    await settle()
    useImportStore.getState().setDesignName('commerce-core')

    useImportStore.getState().switchConnection(conn({ id: 'c2', name: 'staging' }))
    await settle()

    expect(useImportStore.getState().designName).toBe('commerce-core')
  })
})

describe('설계 편집본(Draft) 반영', () => {
  // 회귀(2026-08-03 실측): 기존 설계에 버전을 더하면 **버전만** 생기고 Draft 는 그대로였다.
  // 실 DB 를 40개 읽고도 Design 화면엔 예전 16개가 남아 "가져왔는데 안 들어왔다"가 됐다.
  const design = {
    id: 'd1',
    name: 'pokemon-tcg',
    description: '',
    dialect: 'postgresql' as const,
    schemas: [] as string[]
  }

  it('기본으로 켜져 있다 — 꺼져 있으면 같은 함정을 다시 밟는다', async () => {
    useImportStore.getState().openImport(conn(), design)
    await settle()
    expect(useImportStore.getState().applyToDraft).toBe(true)
  })

  it('최신 버전과 차이가 없어도 설계 반영은 할 수 있다 — 버전만 안 만든다', async () => {
    useImportStore.getState().openImport(conn(), design)
    await settle()
    // 이전 스냅샷 == 지금 읽은 것 → diff 가 빈 상태를 만든다.
    const actual = useImportStore.getState().actual
    useImportStore.setState({ hasPrevVersion: true, prevSnapshot: actual, number: '' })
    useImportStore.getState().chooseMode('version-up')
    await settle()

    await useImportStore.getState().execute()
    await settle()

    // 버전은 안 만들었다.
    expect(api.versions.create).not.toHaveBeenCalled()
    // 그래도 창은 닫혔다 = 할 일을 했다.
    expect(useImportStore.getState().open).toBe(false)
  })
})
