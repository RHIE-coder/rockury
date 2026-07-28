import { describe, expect, it, vi } from 'vitest'

/**
 * TestPlan: parallel-dev · Scenario S4 (CASE-pdev-030 ~ 032)
 *
 * preload 분할은 **순수한 재배치**여야 한다. `window.rockury.*` 경로가 하나라도 바뀌면
 * 렌더러 전체가 조용히 깨진다 — 타입검사로는 안 잡힌다(렌더러는 `window.rockury` 를
 * 전역 타입으로 보고, 실제 객체는 런타임에 조립되기 때문).
 */

// preload 서비스 파일은 electron 의 ipcRenderer 를 직접 import 한다 — 노드 테스트에서 대역을 세운다.
vi.mock('electron', () => ({
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() }
}))

const { assembleApi, SERVICE_APIS } = await import('./index')

/**
 * 분할 **전** `window.rockury` 의 최상위 키 전수(17개).
 * 손으로 적어 둔 대조 기준 — 하나라도 사라지면 그 그룹을 쓰던 화면이 런타임에 죽는다.
 *
 * **줄었는지만 본다(포함 검사).** 서비스가 자기 창구를 여는 건 정상이므로 "정확히 일치"로 보면
 * 창구를 열 때마다 이 공용 테스트가 깨져 병렬 개발 규칙("창구는 자기 서비스 파일에만 더한다")과
 * 충돌한다. 키 충돌은 아래 CASE-pdev-032 가, 빈 값은 CASE-pdev-031 이 따로 막는다.
 */
const KEYS_BEFORE_SPLIT = [
  'ai',
  'collections',
  'connectionGroups',
  'connections',
  'designs',
  'diagram',
  'envVars',
  'environments',
  'introspection',
  'migration',
  'query',
  'savedQueries',
  'seedSets',
  'store',
  'tables',
  'versions',
  'window'
]

/** 분할 전 각 그룹이 갖고 있던 함수 이름 전수. */
const METHODS_BEFORE_SPLIT: Record<string, string[]> = {
  window: ['minimize', 'toggleMaximize', 'close'],
  designs: ['list', 'create', 'update', 'delete'],
  tables: ['list', 'replaceForDesign'],
  seedSets: ['list', 'replaceForDesign'],
  envVars: ['list', 'set', 'delete', 'resolve'],
  store: ['onChanged'],
  versions: ['list', 'create', 'delete'],
  connections: [
    'list',
    'create',
    'update',
    'delete',
    'reorder',
    'move',
    'test',
    'testById',
    'revealPassword'
  ],
  connectionGroups: ['list', 'create', 'rename', 'reorder', 'delete'],
  environments: ['find', 'listByConnection', 'delete', 'ensure', 'setTarget', 'setApplied'],
  introspection: ['run'],
  query: [
    'run',
    'runParams',
    'txBegin',
    'txExec',
    'txExecParams',
    'txCommit',
    'txRollback',
    'explain',
    'historyAppend',
    'historyList',
    'historyClear'
  ],
  savedQueries: [
    'tree',
    'createFolder',
    'createQuery',
    'renameFolder',
    'updateQuery',
    'deleteFolder',
    'deleteQuery',
    'reorderTree'
  ],
  collections: [
    'list',
    'folders',
    'items',
    'create',
    'createFolder',
    'rename',
    'update',
    'renameFolder',
    'deleteFolder',
    'reorderTree',
    'delete',
    'addItem',
    'addReference',
    'updateItem',
    'deleteItem',
    'reorderItems'
  ],
  migration: ['saveSnapshot', 'latestSnapshot', 'appendLog', 'listLogs'],
  ai: ['status', 'rotateToken'],
  diagram: ['getLayout', 'saveLayout', 'clearLayout']
}

describe('preload 서비스 분할', () => {
  const api = assembleApi()

  it('CASE-pdev-030 조립된 표면에 분할 전 최상위 키가 전부 있다', () => {
    expect(Object.keys(api).sort()).toEqual(expect.arrayContaining(KEYS_BEFORE_SPLIT))
  })

  it('CASE-pdev-031 각 그룹의 함수 이름이 분할 전과 같다 — 조용히 빠진 메서드 0', () => {
    for (const [group, methods] of Object.entries(METHODS_BEFORE_SPLIT)) {
      const actual = Object.keys(api[group] as Record<string, unknown>)
      expect(actual.sort(), `${group} 그룹의 함수 목록이 달라졌다`).toEqual([...methods].sort())
    }
  })

  it('CASE-pdev-031 모든 창구가 실제로 함수다 (타입만 맞고 값이 빈 상태 방지)', () => {
    // 분할 전 목록이 아니라 **지금 조립된 전부**를 본다 — 나중에 열린 창구도 같은 검사를 받아야 한다.
    for (const group of Object.keys(api)) {
      for (const [name, fn] of Object.entries(api[group] as Record<string, unknown>)) {
        expect(typeof fn, `${group}.${name} 이 함수가 아니다`).toBe('function')
      }
    }
  })

  it('CASE-pdev-032 두 서비스가 같은 최상위 키를 내놓으면 조립이 실패한다', () => {
    // 분할이 새로 만드는 위험 — 조용히 덮이면 한 서비스의 창구가 통째로 사라진다.
    const clash = [
      { service: 'uiux', api: { canvas: { open: (): void => {} } } },
      { service: 'api', api: { canvas: { close: (): void => {} } } }
    ]
    expect(() => assembleApi(clash)).toThrow(/canvas/)
  })

  it('다섯 서비스 + 셸이 모두 자기 preload 파일을 갖는다', () => {
    expect(SERVICE_APIS.map((s) => s.service).sort()).toEqual([
      'ai',
      'api',
      'db',
      'infra',
      'shell',
      'uiux'
    ])
  })

  it('빈 서비스는 표면에 아무 키도 더하지 않는다 (window.rockury 오염 금지)', () => {
    // uiux 는 2026-07-28 설계 저장소 창구를 열어 목록에서 빠졌다. 아직 빈 자리인 서비스만 남긴다.
    for (const s of SERVICE_APIS) {
      if (['api', 'infra'].includes(s.service)) {
        expect(Object.keys(s.api), `${s.service} 는 아직 창구가 없어야 한다`).toEqual([])
      }
    }
  })
})
