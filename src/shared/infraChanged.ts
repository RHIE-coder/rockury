/**
 * 인프라 저장소가 바뀌었다 — 메인이 알리고 화면이 그만큼 다시 읽는다.
 *
 * DB 의 `store:changed` 나 API 의 `api:changed` 를 빌려 쓰지 않는다 — 서비스끼리 런타임으로
 * 얽히면 병렬 개발의 전제가 깨진다(`uiux/rehydration.ts` 와 같은 규칙).
 *
 * 갈래를 안 쪼갠 이유: 카탈로그·공급자·설계본·스냅샷·미들웨어 연결은 모두 목록이 작고
 * 한 스토어가 함께 든다. 쪼개 봐야 다시 읽는 양이 안 준다.
 */
export interface InfraChangedEvent {
  domain: 'infra'
}
