import { create } from 'zustand'
import { useContextOptions } from '@renderer/nav/contextOptions'
import { useNav } from '@renderer/nav/useNav'
import { dialectInfo, type DialectId } from '../dialects'

/**
 * Connection(원시 접속) 렌더러 스토어(§IA · 결정 B).
 *
 * 설계와 무관한 전역 목록. Console(모니터링/조회/쿼리)이 활성 Connection 을 기준으로 동작한다.
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
}

export interface ConnStatus {
  state: 'idle' | 'testing' | 'ok' | 'error'
  message?: string
  latencyMs?: number
  serverVersion?: string
}

interface ConnectionsState {
  connections: ConnectionDef[]
  loaded: boolean
  statusMap: Record<string, ConnStatus>
  dialogOpen: boolean
  editing: ConnectionDef | null

  init: () => Promise<void>
  create: (form: ConnFormInput) => Promise<ConnectionDef>
  update: (id: string, form: Partial<ConnFormInput>) => Promise<void>
  remove: (id: string) => Promise<void>
  testExisting: (id: string) => Promise<void>
  setStatus: (id: string, status: ConnStatus) => void
  openCreate: () => void
  openEdit: (conn: ConnectionDef) => void
  closeDialog: () => void
}

export const useConnectionsStore = create<ConnectionsState>()((set, get) => ({
  connections: [],
  loaded: false,
  statusMap: {},
  dialogOpen: false,
  editing: null,

  init: async () => {
    const rows = (await window.rockury.connections.list()) as ConnectionDef[]
    set({ connections: rows, loaded: true })
  },

  create: async (form) => {
    const row = (await window.rockury.connections.create(form)) as ConnectionDef
    set((s) => ({ connections: [...s.connections, row] }))
    return row
  },

  update: async (id, form) => {
    const row = (await window.rockury.connections.update(id, form)) as ConnectionDef
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? row : c)) }))
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

  setStatus: (id, status) => set((s) => ({ statusMap: { ...s.statusMap, [id]: status } })),
  openCreate: () => set({ dialogOpen: true, editing: null }),
  openEdit: (conn) => set({ dialogOpen: true, editing: conn }),
  closeDialog: () => set({ dialogOpen: false, editing: null })
}))

// 앱 시작 시 하이드레이션.
void useConnectionsStore.getState().init()

/** connections → 컨텍스트 바 'conn' 셀렉터 옵션 동기화. */
function pushConnOptions(connections: ConnectionDef[]): void {
  useContextOptions.getState().setOptions(
    'conn',
    connections.map((c) => {
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
pushConnOptions(useConnectionsStore.getState().connections)
useConnectionsStore.subscribe((s, prev) => {
  if (s.connections !== prev.connections) pushConnOptions(s.connections)
})

/** 컨텍스트 바에서 선택된 활성 Connection. 미선택이면 null. */
export function useActiveConnection(): ConnectionDef | null {
  const connId = useNav((s) => s.contextValues['conn'])
  const connections = useConnectionsStore((s) => s.connections)
  return connections.find((c) => c.id === connId) ?? null
}
