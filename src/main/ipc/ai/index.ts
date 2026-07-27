/**
 * AI 서비스의 IPC 채널.
 *
 * 새 채널을 만들 때는 이 폴더 안에서만 움직이고,
 * `src/main/ai/coverage/ai.ts` 에 노출 또는 제외로 등재한다.
 * 채널 접두어는 서비스 id 인 `ai:` 다 — MCP 게이트웨이를 다루는 채널도 `ai:mcpStatus` 처럼
 * 서비스 접두어를 쓴다(MCP 는 AI 서비스가 가진 기능 하나이지, 서비스 이름이 아니다).
 */
export { registerAiIpc } from './status'
export type { AiStatusPayload } from './status'
