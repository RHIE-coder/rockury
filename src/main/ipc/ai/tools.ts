import { ipcMain } from 'electron'
import { envelope } from '../envelope'
import { buildToolCatalog, type McpServiceTools } from '../../ai/catalog'

/**
 * AI 화면(도구 목록) IPC — 에이전트에게 열어 둔 MCP 도구를 서비스별로 돌려준다.
 *
 * 목록을 여기서 손으로 관리하지 않는다 — `tools.ts`(도구 정의) + `coverage/`(노출 지도)를
 * 그때그때 조립한다. 그래야 도구가 늘거나 줄어도 화면이 저절로 따라온다.
 */
export type { McpServiceTools } from '../../ai/catalog'

export function registerAiToolsIpc(): void {
  ipcMain.handle('ai:tools', () => envelope((): McpServiceTools[] => buildToolCatalog()))
}
