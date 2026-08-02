import { markAgentActivity } from './agentActivity'

/**
 * 에이전트(MCP) 쓰기 → 레일 점. **앱이 뜰 때 한 번** 걸리는 부수효과 모듈이다.
 *
 * 왜 서비스 안이 아니라 셸에 있는가: 서비스의 리하이드레이션 모듈은 그 서비스 **화면을 열 때**
 * 로드된다(선언 파일이 스토어를 정적으로 안 끄는 규율 — `services/uiux/index.tsx` 주석).
 * 거기에 표시를 맡기면 DB 화면을 보고 있는 동안 에이전트가 UI/UX 를 고쳐도 점이 안 켜진다.
 * 정작 알아야 할 때가 **다른 서비스를 보고 있을 때**라 그건 뒤집힌 것이다.
 *
 * 그래서 셸은 "어느 서비스가 밖에서 바뀌었나"만 듣고, **무엇을 다시 읽을지는 각 서비스가**
 * 자기 리하이드레이션에서 정한다 — 셸이 서비스 데이터를 아는 일은 여기서도 없다.
 */
export function subscribeAgentActivity(): void {
  window.rockury.store.onChanged(() => markAgentActivity('db'))
  window.rockury.apiSpecs.onChanged(() => markAgentActivity('api'))
  window.rockury.uiux.onChanged(() => markAgentActivity('uiux'))
}
