import { create } from 'zustand'
import type { GrantSetItem, GrantSetRecord, GrantsIR } from './types'

/**
 * 권한(Grant) 스토어(§db-remote.grants) — 연결별 IR 캐시 + 권한 세트 목록.
 * IR 은 휘발(새로고침으로 갱신), 세트는 앱 로컬 저장소가 정본이고 여기는 사본이다.
 */
interface GrantsState {
  byConn: Record<string, GrantsIR>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  sets: GrantSetRecord[]
  setsLoaded: boolean
  /** 세트 목록을 못 읽었을 때의 사유 — 빈 목록을 "없다"로 그리지 않기 위한 자리. */
  setsError: string | null
  load: (connId: string, force?: boolean) => Promise<void>
  loadSets: () => Promise<void>
  createSet: (name: string, items: GrantSetItem[]) => Promise<GrantSetRecord>
  updateSet: (id: string, patch: { name?: string; items?: GrantSetItem[] }) => Promise<void>
  deleteSet: (id: string) => Promise<void>
}

export const useGrantsStore = create<GrantsState>()((set, get) => ({
  byConn: {},
  loading: {},
  error: {},
  sets: [],
  setsLoaded: false,
  setsError: null,
  load: async (connId, force = false) => {
    if (!force && get().byConn[connId]) return
    if (get().loading[connId]) return
    set((s) => ({ loading: { ...s.loading, [connId]: true }, error: { ...s.error, [connId]: null } }))
    try {
      const ir = await window.rockury.grants.run(connId)
      set((s) => ({ byConn: { ...s.byConn, [connId]: ir }, loading: { ...s.loading, [connId]: false } }))
    } catch (e) {
      set((s) => ({
        loading: { ...s.loading, [connId]: false },
        error: { ...s.error, [connId]: e instanceof Error ? e.message : String(e) }
      }))
    }
  },
  loadSets: async () => {
    try {
      const sets = await window.rockury.grantSets.list()
      set({ sets, setsLoaded: true, setsError: null })
    } catch (e) {
      // 실패를 삼키면 패널이 "저장된 세트 없음"이라는 거짓 빈 상태가 된다(리뷰 지적).
      set({ setsLoaded: true, setsError: e instanceof Error ? e.message : String(e) })
    }
  },
  createSet: async (name, items) => {
    const rec = await window.rockury.grantSets.create(name, items)
    set((s) => ({ sets: [...s.sets, rec].sort((a, b) => a.name.localeCompare(b.name)) }))
    return rec
  },
  updateSet: async (id, patch) => {
    await window.rockury.grantSets.update(id, patch)
    await get().loadSets()
  },
  deleteSet: async (id) => {
    await window.rockury.grantSets.delete(id)
    set((s) => ({ sets: s.sets.filter((x) => x.id !== id) }))
  }
}))
