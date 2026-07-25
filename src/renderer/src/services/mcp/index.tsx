import { Bot, Sparkles } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { AgentsWorkspace } from './AgentsWorkspace'

/**
 * AI 서비스(내부 id: mcp) — AI 에이전트 연동(§spec mcp-server.md).
 * depth 2 단일 워크스페이스: 게이트웨이 상태 + 프로젝트 지정·에이전트 설정 셋업.
 */
export const mcpService: Service = {
  id: 'mcp', // 내부 id 는 유지(nav 훅·스모크 셀렉터 안정) — 표시명만 AI
  label: 'AI',
  icon: Sparkles,
  modules: [{ id: 'agents', label: 'Agents', icon: Bot, workspace: AgentsWorkspace }]
}
