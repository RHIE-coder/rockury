import { ipcRenderer } from 'electron'
import { unwrap } from '../envelope'
import type { McpStatusPayload } from '../../main/ipc/mcp'

/**
 * AI 서비스(코드 id `mcp`)가 렌더러에 여는 창구.
 *
 * 새 창구가 필요하면 이 파일에만 더한다 — `src/preload/index.ts` 나 다른 서비스 파일은
 * 건드리지 않는다(병렬 개발 파일 소유권, AGENTS.md).
 */
export const mcpApi = {
  // AI(에이전트 연동) — 게이트웨이 상태 + 접속 키 관리(등록 명령 복사 방식).
  mcp: {
    status: (): Promise<McpStatusPayload> => unwrap(ipcRenderer.invoke('mcp:status')),
    rotateToken: (): Promise<McpStatusPayload> => unwrap(ipcRenderer.invoke('mcp:rotateToken'))
  }
}
