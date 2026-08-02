import { useSpecStore } from './store'
import { useNav } from '@renderer/nav/useNav'

/**
 * 에이전트(MCP) 쓰기 리하이드레이션 — 메인이 보내는 `uiux:changed` 를 받아 **그 스코프만**
 * 다시 읽는다(spec `uiux-ia.md` §8). 화면발 저장은 도구를 안 거치므로 이 이벤트를 만들지
 * 않는다 — 여기 도착한 변경은 전부 "화면 밖에서 온 것"이라 자기 메아리가 없다.
 *
 * DB 의 `store:changed`·API 의 `api:changed` 를 빌려 쓰지 않는다 — 서비스끼리 런타임으로
 * 얽히면 병렬 개발의 전제가 깨진다.
 *
 * 레일 점(어느 서비스가 바뀌었나)은 여기서 찍지 않는다 — 이 모듈은 UI/UX **화면을 열어야**
 * 로드되는데, 표시가 필요한 때는 오히려 다른 서비스를 보고 있을 때다. 그건 셸이 든다
 * (`shell/agentActivityBridge.ts`).
 */
window.rockury.uiux.onChanged((e) => {
  void (async () => {
    const store = useSpecStore.getState()
    const active = (): string | null => useNav.getState().contextValues['project'] ?? null

    // 프로젝트 자체가 새로 생겼을 수 있어 목록부터 — 안 하면 셀렉터가 계속 "고를 프로젝트 없음"이다.
    if (e.domain === 'nodes') {
      await store.init()
      return
    }

    // 지금 안 보고 있는 프로젝트의 변경이면 다시 읽을 것이 없다 — 그 프로젝트를 열 때 읽힌다.
    if (e.projectId && e.projectId !== active()) return

    if (e.domain === 'tokens') {
      await store.loadTokens(active())
      return
    }
    if (e.domain === 'notes') {
      await store.loadNotes(useSpecStore.getState().selectedSurfaceId)
      return
    }

    // surface · status — 위계(상태 집계)와 화면 내용이 함께 바뀐다.
    await store.loadTree(active())
    // 트리를 다시 읽어도 열려 있는 화면의 `content` 는 안 따라온다(트리 행에서 한 번 떠 온 값이라).
    const selected = useSpecStore.getState().selectedSurfaceId
    if (selected) useSpecStore.getState().selectSurface(selected)
  })().catch((err) => console.error('[uiux rehydration] 재조회 실패:', err))
})
