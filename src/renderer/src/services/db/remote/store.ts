import { create } from 'zustand'
import type { TableDef } from '../workspaces/definition/types'
import { normalizeSchema } from './introspection'

/**
 * Remote introspection 스토어(§ops-plan Phase 2a) — 활성 환경의 실 DB 역설계 결과 캐시.
 * IR(main) → `normalizeSchema` → TableDef[] 를 환경별로 담는다. 상태는 휘발(재조회로 갱신).
 */
interface RemoteState {
  byEnv: Record<string, TableDef[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  /**
   * 역설계가 **못 읽은 것**이 있으면 그 사유. 오류(error)와 다르다 — 결과는 왔지만 일부가 빈다.
   * 조용히 두면 사용자는 있는 것을 없다고 믿는다(권한에 가려진 제약이 그랬다).
   */
  warnings: Record<string, string[]>
  /**
   * 활성 환경의 스키마를 역설계한다. 캐시가 있으면 스킵(force=true 로 강제 새로고침).
   * `schemas` 는 읽을 범위 — 안 주면 연결에 저장된 범위를 쓴다. 범위를 막 바꾼 직후에는
   * 저장이 끝나기를 기다리지 않고 새 값을 그대로 넘긴다.
   */
  load: (envId: string, designId: string, force?: boolean, schemas?: string[]) => Promise<void>
}

export const useRemoteStore = create<RemoteState>()((set, get) => ({
  byEnv: {},
  loading: {},
  error: {},
  warnings: {},
  load: async (envId, designId, force = false, schemas) => {
    if (!force && get().byEnv[envId]) return
    if (get().loading[envId]) return
    set((s) => ({ loading: { ...s.loading, [envId]: true }, error: { ...s.error, [envId]: null } }))
    try {
      const ir = await window.rockury.introspection.run(envId, schemas)
      const tables = normalizeSchema(ir, designId)
      set((s) => ({
        byEnv: { ...s.byEnv, [envId]: tables },
        warnings: { ...s.warnings, [envId]: ir.warnings ?? [] },
        loading: { ...s.loading, [envId]: false }
      }))
    } catch (e) {
      set((s) => ({
        loading: { ...s.loading, [envId]: false },
        error: { ...s.error, [envId]: e instanceof Error ? e.message : String(e) }
      }))
    }
  }
}))
