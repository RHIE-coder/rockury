/**
 * AI 서비스(코드 id `mcp`)의 IPC 채널.
 *
 * 새 채널을 만들 때는 이 폴더 안에서만 움직이고,
 * `src/main/mcp/coverage/mcp.ts` 에 노출 또는 제외로 등재한다.
 */
export { registerMcpIpc } from './status'
export type { McpStatusPayload } from './status'
