import { useConnectionsStore } from './connections/store'
import { useDesignsStore } from './designs/store'
import { useVersionsStore } from './versions/store'
import { toTableDef } from './workspaces/definition/designScope'
import { rehydrateDesignTables } from './workspaces/definition/store'

/**
 * 리하이드레이션 — 메인이 보내는 store:changed 를 받아 해당 스코프만 다시 읽는다
 * (spec ai-server tools.rehydration AC-2).
 *
 * 여기 도착한 변경은 전부 **이 창 밖에서 온 것**이다: 에이전트(MCP) 쓰기이거나, 다른 창이 한
 * 쓰기다. 이 창이 한 쓰기는 안 온다(AC-3) — 그건 낙관 반영으로 이미 화면에 있다.
 */
window.rockury.store.onChanged((e) => {
  void (async () => {
    if (e.domain === 'designs') {
      await useDesignsStore.getState().init() // 목록 전체 재조회(설계 수는 작다)
    } else if (e.domain === 'tables') {
      const recs = await window.rockury.tables.list()
      rehydrateDesignTables(
        e.designId,
        recs.filter((r) => r.designId === e.designId).map(toTableDef)
      )
    } else if (e.domain === 'versions') {
      await useVersionsStore.getState().refresh(e.designId)
    } else if (e.domain === 'connections') {
      // 접속·그룹은 한 덩이로 다시 읽는다 — 목록이 작고, 그룹 이동이 둘을 함께 바꾼다.
      await useConnectionsStore.getState().init()
      await useConnectionsStore.getState().loadSample()
    }
  })().catch((err) => console.error('[rehydration] 재조회 실패:', err))
})
