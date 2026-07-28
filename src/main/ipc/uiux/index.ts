import { registerUiuxSpecsIpc } from './specs'

/**
 * UI/UX 서비스의 IPC 채널.
 *
 * 채널 접두어는 서비스 id(`uiux:`) — AGENTS.md 네임스페이스 규칙.
 * 새 주제를 더할 때: 여기에 `<주제>.ts` 를 만들고 아래에서 부르고,
 * `src/main/ai/coverage/uiux.ts` 에 노출·제외를 등재한다(안 하면 `npm test` 실패).
 * `src/main/index.ts` 나 다른 서비스 폴더는 건드리지 않는다.
 */
export function registerUiuxIpc(): void {
  registerUiuxSpecsIpc()
}
