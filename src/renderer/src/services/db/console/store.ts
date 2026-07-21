import { create } from 'zustand'
import type { TableDef } from '../workspaces/definition/types'
import { normalizeSchema } from './introspection'

/**
 * Console introspection 스토어(§ops-plan Phase 2a) — 활성 환경의 실 DB 역설계 결과 캐시.
 * IR(main) → `normalizeSchema` → TableDef[] 를 환경별로 담는다. 상태는 휘발(재조회로 갱신).
 */
interface ConsoleState {
  byEnv: Record<string, TableDef[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  /** 활성 환경의 스키마를 역설계한다. 캐시가 있으면 스킵(force=true 로 강제 새로고침). */
  load: (envId: string, designId: string, force?: boolean) => Promise<void>
}

export const useConsoleStore = create<ConsoleState>()((set, get) => ({
  byEnv: {},
  loading: {},
  error: {},
  load: async (envId, designId, force = false) => {
    if (!force && get().byEnv[envId]) return
    if (get().loading[envId]) return
    set((s) => ({ loading: { ...s.loading, [envId]: true }, error: { ...s.error, [envId]: null } }))
    try {
      const ir = await window.rockury.introspection.run(envId)
      const tables = normalizeSchema(ir, designId)
      set((s) => ({ byEnv: { ...s.byEnv, [envId]: tables }, loading: { ...s.loading, [envId]: false } }))
    } catch (e) {
      set((s) => ({
        loading: { ...s.loading, [envId]: false },
        error: { ...s.error, [envId]: e instanceof Error ? e.message : String(e) }
      }))
    }
  }
}))
