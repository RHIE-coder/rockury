/**
 * "로컬 저장소가 바뀌었다" 알림 — 메인이 열린 창들에 보내고, 렌더러가 그 스코프만 다시 읽는다.
 *
 * 두 갈래가 같은 채널(`store:changed`)을 쓴다:
 * ⑴ 에이전트(MCP) 쓰기 — 창 밖에서 왔으므로 **모든 창**에.
 * ⑵ 화면발 쓰기(IPC) — **쓴 창만 빼고** 나머지 창에(`ipc/peers.ts`).
 *
 * ⑵ 가 없으면 창마다 시작할 때 한 번 읽은 사본이 영영 안 맞는다 — 한쪽에서 접속을 만들어도
 * 다른 창은 모르고, 그 창에서 편집하면 폼을 통째로 덮어써 남의 수정을 지운다(2026-08-07 실측).
 *
 * 메인·preload·렌더러 셋이 함께 읽는 모양이라 공용(@shared)에 둔다.
 */

/** 설계 스코프를 갖는 갈래 — 어느 설계가 바뀌었는지까지 알려야 그 설계만 다시 읽는다. */
export interface DesignScopedChange {
  domain: 'designs' | 'tables' | 'versions'
  designId: string
}

/** 설계와 무관한 전역 목록 — 목록 전체를 다시 읽으면 되므로 스코프가 없다. */
export interface GlobalListChange {
  domain: 'connections'
}

export type StoreChangedEvent = DesignScopedChange | GlobalListChange
