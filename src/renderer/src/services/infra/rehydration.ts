import { useInfraStore } from './store'

/**
 * 리하이드레이션 — 메인이 보내는 `infra:changed` 를 받아 목록을 다시 읽는다.
 *
 * 여기 도착한 변경은 전부 **이 창 밖에서 온 것**이다: 다른 창이 한 쓰기다. 이 창이 한 쓰기는
 * 안 온다 — 그건 낙관 반영으로 이미 화면에 있다(`main/ipc/peers.ts`).
 *
 * 갈래를 안 가르는 이유는 이벤트 쪽 머리말과 같다 — 인프라 목록은 한 스토어가 함께 들고
 * 있어서, 쪼개 봐야 다시 읽는 양이 안 준다.
 *
 * DB 의 `store:changed`·API 의 `api:changed` 를 빌려 쓰지 않는다 — 서비스끼리 런타임으로
 * 얽히면 병렬 개발의 전제가 깨진다.
 */
window.rockury.infra.onChanged(() => {
  void useInfraStore
    .getState()
    .init()
    .catch((err) => console.error('[infra rehydration] 재조회 실패:', err))
})
