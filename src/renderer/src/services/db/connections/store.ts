import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { filterByScope, type ProjectScope } from '@renderer/shell/projectScope'
import { useProjectStore } from '@renderer/shell/projectStore'
import { dialectInfo, type DialectId } from '../dialects'
import { partitionAutoCheck } from './autoCheck'

/**
 * Connection(원시 접속) 렌더러 스토어(§IA · 결정 B).
 *
 * 설계와 무관한 전역 목록. Remote(모니터링/조회/쿼리)가 활성 Connection 을 기준으로 동작한다.
 * 영속(CRUD)은 main SQLite(window.rockury.connections), 연결 상태(statusMap)는 휘발.
 * 컨텍스트 바 'conn' 셀렉터 옵션은 designs/store 처럼 이 스토어가 직접 주입한다.
 */
export type ConnDbType = DialectId

export interface ConnectionDef {
  id: string
  name: string
  dbType: ConnDbType
  host: string
  port: number
  database: string
  user: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  /**
   * 범위(scope) — 이 연결에서 지금 보고 있는 스키마 목록.
   * 빈 배열이면 "기본 스키마 하나"다(예전 연결·단일 스키마 사용자). §db-remote.scope
   */
  schemas: string[]
  autoCheckDisabled: boolean
  groupId: string | null
  /**
   * 속한 프로젝트. null 이면 **공용** — 로컬 테스트 DB 처럼 프로젝트를 가리지 않고 쓰는 접속이라
   * 어느 프로젝트를 보고 있어도 목록에 남는다(설계류와 갈리는 유일한 지점).
   */
  projectId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Connection 그룹(접속 카드 분류 — 1단계, 중첩 없음). */
export interface ConnGroupDef {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ConnFormInput {
  name: string
  dbType: ConnDbType
  host: string
  port: number
  database: string
  user: string
  password: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  autoCheckDisabled: boolean
}

export interface ConnStatus {
  state: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  latencyMs?: number
  serverVersion?: string
}

interface ConnectionsState {
  connections: ConnectionDef[]
  groups: ConnGroupDef[]
  loaded: boolean
  statusMap: Record<string, ConnStatus>
  dialogOpen: boolean
  editing: ConnectionDef | null

  init: () => Promise<void>
  create: (form: ConnFormInput) => Promise<ConnectionDef>
  update: (id: string, form: Partial<ConnFormInput>) => Promise<void>
  remove: (id: string) => Promise<void>
  testExisting: (id: string) => Promise<void>
  testAll: () => Promise<void>
  reveal: (id: string) => Promise<string>
  /** 범위 갈아끼우기 — 낙관 반영 후 영속. 실 DB 재조회는 이 값을 보는 쪽(remote store)이 한다. */
  setSchemas: (id: string, schemas: string[]) => Promise<void>
  setStatus: (id: string, status: ConnStatus) => void
  openCreate: () => void
  openEdit: (conn: ConnectionDef) => void
  closeDialog: () => void

  createGroup: (name: string) => Promise<ConnGroupDef>
  renameGroup: (id: string, name: string) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  reorderGroups: (orderedIds: string[]) => Promise<void>
  move: (connId: string, groupId: string | null, orderedIds: string[]) => Promise<void>
}

export const useConnectionsStore = create<ConnectionsState>()((set, get) => ({
  connections: [],
  groups: [],
  loaded: false,
  statusMap: {},
  dialogOpen: false,
  editing: null,

  init: async () => {
    const [rows, groups] = await Promise.all([
      window.rockury.connections.list() as Promise<ConnectionDef[]>,
      window.rockury.connectionGroups.list() as Promise<ConnGroupDef[]>
    ])
    set({ connections: rows, groups, loaded: true })
  },

  create: async (form) => {
    // 지금 보고 있는 프로젝트가 그대로 소속이 된다. 전체·프로젝트 없음이면 공용으로 만들어진다.
    const scope = useProjectStore.getState().scope
    const projectId = scope.kind === 'one' ? scope.projectId : null
    const row = (await window.rockury.connections.create({ ...form, projectId })) as ConnectionDef
    set((s) => ({ connections: [...s.connections, row] }))
    return row
  },

  update: async (id, form) => {
    const prev = get().connections.find((c) => c.id === id)
    const row = (await window.rockury.connections.update(id, form)) as ConnectionDef
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? row : c)) }))
    // 방금 "자동 확인 제외"로 바꿨으면 이전 확인 결과를 즉시 '미확인'으로 — 잔존 실패가 남아 있으면
    // 제외가 안 먹는 것처럼 보인다(사용자 실측 혼동).
    if (prev && !prev.autoCheckDisabled && row.autoCheckDisabled) get().setStatus(id, { state: 'idle' })
  },

  remove: async (id) => {
    await window.rockury.connections.delete(id)
    set((s) => {
      const statusMap = { ...s.statusMap }
      delete statusMap[id]
      return { connections: s.connections.filter((c) => c.id !== id), statusMap }
    })
  },

  testExisting: async (id) => {
    get().setStatus(id, { state: 'testing' })
    try {
      const r = await window.rockury.connections.testById(id)
      get().setStatus(id, {
        state: r.success ? 'ok' : 'error',
        message: r.message,
        latencyMs: r.latencyMs,
        serverVersion: r.serverVersion
      })
    } catch (e) {
      get().setStatus(id, { state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  },

  // 페이지 진입·새로고침의 전체 확인 — "자동 확인 무시" 연결은 건너뛴다. 각 확인은 병렬.
  testAll: async () => {
    const { targets, skipped } = partitionAutoCheck(get().connections)
    // 건너뛴 연결의 옛 결과는 '미확인'으로 되돌린다 — 새로고침 후에도 이전 "실패"가 남아
    // 자동 확인이 계속 도는 것처럼 읽히는 것을 막는다.
    for (const c of skipped) get().setStatus(c.id, { state: 'idle' })
    await Promise.all(targets.map((c) => get().testExisting(c.id)))
  },

  // 저장된 비밀번호 평문 조회(편집 화면 눈 아이콘 프리필). 실패 시 빈 문자열.
  reveal: async (id) => {
    try {
      return await window.rockury.connections.revealPassword(id)
    } catch {
      return ''
    }
  },

  setSchemas: async (id, schemas) => {
    const prev = get().connections.find((c) => c.id === id)?.schemas ?? []
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, schemas } : c)) }))
    try {
      await window.rockury.connections.update(id, { schemas })
    } catch {
      // 저장 실패 시 화면을 되돌린다 — 안 그러면 "골랐는데 다음에 열면 없다"가 된다.
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, schemas: prev } : c)) }))
    }
  },

  setStatus: (id, status) => set((s) => ({ statusMap: { ...s.statusMap, [id]: status } })),
  openCreate: () => set({ dialogOpen: true, editing: null }),
  openEdit: (conn) => set({ dialogOpen: true, editing: conn }),
  closeDialog: () => set({ dialogOpen: false, editing: null }),

  createGroup: async (name) => {
    const g = (await window.rockury.connectionGroups.create(name)) as ConnGroupDef
    set((s) => ({ groups: [...s.groups, g] }))
    return g
  },

  renameGroup: async (id, name) => {
    const g = (await window.rockury.connectionGroups.rename(id, name)) as ConnGroupDef
    set((s) => ({ groups: s.groups.map((x) => (x.id === id ? g : x)) }))
  },

  // 그룹 순서 변경(DnD) — 낙관 반영 후 영속. 실패 시 저장소 기준 재로드.
  reorderGroups: async (orderedIds) => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    set((s) => ({ groups: [...s.groups].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)) }))
    try {
      await window.rockury.connectionGroups.reorder(orderedIds)
    } catch {
      await get().init()
    }
  },

  // 그룹 삭제 — 소속 연결은 지우지 않고 미분류로 되돌린다(메인과 동일 규약).
  removeGroup: async (id) => {
    await window.rockury.connectionGroups.delete(id)
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      connections: s.connections.map((c) => (c.groupId === id ? { ...c, groupId: null } : c))
    }))
  },

  // DnD 드롭 — 낙관 반영 후 영속. 실패하면 저장소 기준으로 되돌린다(재로드).
  move: async (connId, groupId, orderedIds) => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    set((s) => ({
      connections: [...s.connections]
        .map((c) => (c.id === connId ? { ...c, groupId } : c))
        .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    }))
    try {
      await window.rockury.connections.move(connId, groupId, orderedIds)
    } catch {
      await get().init()
    }
  }
}))

// 앱 시작 시 하이드레이션.
void useConnectionsStore.getState().init()

/**
 * connections → 'conn' 셀렉터 옵션 동기화. **프로젝트 범위로 먼저 거른다** —
 * 접속은 쓰는 도구라 무소속은 공용으로 남는다(shared). 남의 프로젝트 것만 숨는다.
 */
function pushConnOptions(connections: ConnectionDef[], scope: ProjectScope): void {
  useContextOptions.getState().setOptions(
    'conn',
    filterByScope(connections, scope, 'shared').map((c) => {
      const info = dialectInfo(c.dbType)
      return {
        id: c.id,
        label: c.name,
        hint: info.label,
        dot: info.dot,
        subtitle: c.dbType === 'sqlite' ? c.database : `${c.database}@${c.host}:${c.port}`
      }
    })
  )
}
function syncConnOptions(): void {
  pushConnOptions(useConnectionsStore.getState().connections, useProjectStore.getState().scope)
}

syncConnOptions()
useConnectionsStore.subscribe((s, prev) => {
  if (s.connections !== prev.connections) syncConnOptions()
})
useProjectStore.subscribe((s, prev) => {
  if (s.scope !== prev.scope) syncConnOptions()
  // 소속 정리 창이 저장소를 직접 고쳤다 — 우리가 든 사본은 아직 옛 소속이라 다시 읽는다.
  if (s.itemsRevision !== prev.itemsRevision) void useConnectionsStore.getState().init()
})

/** 지금 프로젝트 범위에 드는 접속만 — 무소속(공용)은 늘 포함된다. 목록 화면이 쓴다. */
export function useScopedConnections(): ConnectionDef[] {
  const connections = useConnectionsStore((s) => s.connections)
  const scope = useProjectStore((s) => s.scope)
  return filterByScope(connections, scope, 'shared')
}

/** 컨텍스트 바에서 선택된 활성 Connection. 미선택이면 null. */
export function useActiveConnection(): ConnectionDef | null {
  const connId = useNav((s) => s.contextValues['conn'])
  const connections = useConnectionsStore((s) => s.connections)
  return connections.find((c) => c.id === connId) ?? null
}
