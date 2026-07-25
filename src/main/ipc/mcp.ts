import { ipcMain } from 'electron'
import { envelope } from './envelope'
import { getMcpInfo, rotateMcpToken, type McpInfo } from '../mcp/http'
import { buildAgentCommands } from '../mcp/registration'

/**
 * AI 화면(에이전트 연동) IPC — 게이트웨이 상태 + 접속 키 관리.
 * 연동은 "등록 명령 복사" 방식 하나로 통일(프로젝트별 .mcp.json 셋업 방식은 2026-07-24 제거 —
 * 사용자 결정. 프로젝트 파일을 앱이 건드리지 않는다).
 */

/**
 * 게이트웨이 상태 + 접속 키 + 등록/재등록 명령. token/명령은 복사·마스킹 표시용(렌더러는 신뢰 경계 안).
 * 재등록 명령은 접속 키를 재발급(rotate)해 기존 등록이 끊긴 뒤 다시 잇는 용도(remove→add).
 */
export interface McpStatusPayload {
  running: boolean
  url: string | null
  port: number | null
  token: string | null
  claudeCommand: string | null
  codexCommand: string | null
  claudeReregisterCommand: string | null
  codexReregisterCommand: string | null
}

const OFFLINE: McpStatusPayload = {
  running: false, url: null, port: null, token: null,
  claudeCommand: null, codexCommand: null, claudeReregisterCommand: null, codexReregisterCommand: null
}

function toStatus(info: McpInfo | null): McpStatusPayload {
  if (!info) return OFFLINE
  return { running: true, url: info.url, port: info.port, token: info.token, ...buildAgentCommands(info.url, info.token) }
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:status', () => envelope(() => toStatus(getMcpInfo())))

  // 접속 키 재발급 — 즉시 적용(구 키 401). 기존 등록 에이전트는 재등록 필요(UI 가 확인 후 호출).
  ipcMain.handle('mcp:rotateToken', () => envelope(() => toStatus(rotateMcpToken())))
}
