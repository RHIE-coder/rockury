import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Environment(연결↔설계 결속) 렌더러 스토어 — 관리 UI 전용.
 * 백엔드(window.rockury.environments)의 바인딩을 연결별로 읽어 카드 배지·관리 다이얼로그에 쓴다.
 * (Migration 진입 시의 자동 결속은 migration/store 가 담당 — 여긴 사람이 보고 만지는 표면.)
 */
export interface ConnectionBinding {
  id: string
  connectionId: string
  designId: string
  targetVersion: string
  appliedVersion: string | null
}

interface EnvManageState {
  /** 연결별 바인딩 목록. 캐시하지 않고 항상 최신으로 다시 읽는다 —
   *  Migration·가져오기 등 다른 경로가 만든 바인딩이 즉시 드러나야 하므로(stale 방지). */
  byConnection: Record<string, ConnectionBinding[]>
  /** 관리 다이얼로그가 열린 연결 id(null 이면 닫힘). */
  manageConnId: string | null
  busy: boolean
  error: string | null

  reload: (connectionId: string) => Promise<void>
  openManage: (connectionId: string) => void
  close: () => void
  bind: (connectionId: string, designId: string, targetVersion?: string) => Promise<void>
  unbind: (connectionId: string, id: string) => Promise<void>
  retarget: (connectionId: string, id: string, version: string) => Promise<void>
}

export const useEnvManageStore = create<EnvManageState>()((set, get) => ({
  byConnection: {},
  manageConnId: null,
  busy: false,
  error: null,

  reload: async (connectionId) => {
    try {
      const rows = (await window.rockury.environments.listByConnection(connectionId)) as ConnectionBinding[]
      set((s) => ({ byConnection: { ...s.byConnection, [connectionId]: rows } }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  openManage: (connectionId) => {
    set({ manageConnId: connectionId, error: null })
    void get().reload(connectionId)
  },

  close: () => set({ manageConnId: null, error: null }),

  bind: async (connectionId, designId, targetVersion = '') => {
    set({ busy: true, error: null })
    try {
      await window.rockury.environments.ensure(connectionId, designId, targetVersion)
      await get().reload(connectionId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ busy: false })
    }
  },

  unbind: async (connectionId, id) => {
    set({ busy: true, error: null })
    try {
      await window.rockury.environments.delete(id)
      await get().reload(connectionId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ busy: false })
    }
  },

  retarget: async (connectionId, id, version) => {
    set({ busy: true, error: null })
    try {
      await window.rockury.environments.setTarget(id, version)
      await get().reload(connectionId)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ busy: false })
    }
  }
}))

/** 연결의 바인딩 목록(카드 배지용). 마운트마다 새로 읽어 최신을 유지(다른 경로 변경 반영). */
export function useConnectionBindings(connectionId: string): ConnectionBinding[] {
  const reload = useEnvManageStore((s) => s.reload)
  const list = useEnvManageStore((s) => s.byConnection[connectionId])
  useEffect(() => {
    void reload(connectionId)
  }, [connectionId, reload])
  return list ?? []
}
