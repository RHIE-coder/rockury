import { useApiStore } from './store'
import { useNav, activeContext } from '@renderer/nav/useNav'

/**
 * 리하이드레이션 — 메인이 보내는 `api:changed` 를 받아 해당 스코프만 다시 읽는다
 * (spec api-mcp tools.write AC-8).
 *
 * 여기 도착한 변경은 전부 **이 창 밖에서 온 것**이다: 에이전트(MCP) 쓰기이거나, 다른 창이 한
 * 쓰기다(2026-08-08). 이 창이 한 쓰기는 안 온다 — 그건 낙관 반영으로 이미 화면에 있다.
 *
 * DB 서비스의 `store:changed` 를 빌려 쓰지 않는다 — 서비스끼리 런타임으로 얽히면
 * 병렬 개발의 전제가 깨진다.
 */
window.rockury.apiSpecs.onChanged((e) => {
  void (async () => {
    if (e.domain === 'specs') {
      await useApiStore.getState().init()
      // 지금 보고 있는 명세면 내용까지 다시 읽는다.
      if (activeContext(useNav.getState())['spec'] === e.specId) {
        await useApiStore.getState().loadSpec(e.specId)
      }
      return
    }
    if (activeContext(useNav.getState())['spec'] === e.specId) {
      await useApiStore.getState().loadSpec(e.specId)
    }
    await useApiStore.getState().init()
  })().catch((err) => console.error('[api rehydration] 재조회 실패:', err))
})
