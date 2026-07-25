import { useDesignsStore } from './designs/store'
import { useVersionsStore } from './versions/store'
import { toTableDef } from './workspaces/definition/designScope'
import { rehydrateDesignTables } from './workspaces/definition/store'

/**
 * 에이전트(MCP) 쓰기 리하이드레이션 — 메인이 보내는 store:changed 를 받아 해당 스코프만
 * 다시 읽는다(spec mcp-server tools.rehydration AC-2). 렌더러발 저장은 이 이벤트를 만들지
 * 않으므로(AC-3) 여기 도착한 변경은 전부 "화면 밖에서 온 것"이다.
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
    }
  })().catch((err) => console.error('[rehydration] 재조회 실패:', err))
})
