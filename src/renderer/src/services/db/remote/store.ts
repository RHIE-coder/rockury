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

/**
 * 읽는 중에 들어온 **강제** 재조회를 담아 두는 자리(연결 → 읽을 범위). 끝나면 한 번 더 읽는다.
 *
 * 왜 버리면 안 되나: Query 로 DDL 을 두 번 잇달아 치면 두 번째 요청이 첫 조회가 도는 동안
 * 도착한다. 그걸 버리면 **첫 DDL 만 반영된 목록**이 최종본으로 굳고, 다시 읽힐 계기가 없어
 * 사용자는 자동 반영이 또 안 된다고 본다.
 * 강제가 아닌 요청은 담지 않는다 — 캐시가 있으면 어차피 건너뛸 것이라 예약할 것이 없다.
 */
const queued = new Map<string, string[] | undefined>()

/**
 * 실 DB 구조가 바뀌었으니 역설계를 다시 읽으라고 **시킨다**(끝나기를 기다리지 않는다).
 *
 * Data·Definition·Diagram·Object·Query 가 한 캐시(연결별)를 보므로 여기 한 번이면 다 맞춰진다.
 * 부르는 쪽은 DDL 을 실행한 자리들이다 — Definition 의 스키마 편집, Query 의 실행,
 * Collection 의 일괄 실행. 한 군데라도 빠지면 **같은 `ALTER TABLE` 을 어디서 쳤느냐**에 따라
 * 목록이 다르게 굴어서, 사용자에겐 새로고침이 고장난 것으로 보인다(2026-09-03 지적).
 *
 * 실패는 `load` 가 삼켜 화면의 오류 자리로 보낸다.
 */
export function reintrospect(connectionId: string): void {
  void useRemoteStore.getState().load(connectionId, connectionId, true)
}

export const useRemoteStore = create<RemoteState>()((set, get) => ({
  byEnv: {},
  loading: {},
  error: {},
  warnings: {},
  load: async (envId, designId, force = false, schemas) => {
    if (!force && get().byEnv[envId]) return
    if (get().loading[envId]) {
      if (force) queued.set(envId, schemas)
      return
    }
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
    // 읽는 동안 밀려 있던 강제 재조회를 이어서 한 번 더. 먼저 지우고 부른다 — 안 그러면
    // 그 조회가 또 자기를 예약해 끝나지 않는다.
    if (queued.has(envId)) {
      const next = queued.get(envId)
      queued.delete(envId)
      await get().load(envId, designId, true, next)
    }
  }
}))
