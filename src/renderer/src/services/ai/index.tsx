import { Bot, Sparkles } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { AgentsWorkspace } from './AgentsWorkspace'

/**
 * AI 서비스 — 지금은 에이전트 연동(MCP)이 유일한 모듈이다(§spec ai-server.md).
 * MCP 는 이 서비스가 가진 **기능 하나**다. 서비스가 넓어지면 모듈이 늘어난다.
 * depth 2 단일 워크스페이스: 게이트웨이 상태 + 프로젝트 지정·에이전트 설정 셋업.
 */
export const aiService: Service = {
  id: 'ai',
  label: 'AI',
  icon: Sparkles,
  modules: [{ id: 'agents', label: 'Agents', icon: Bot, workspace: AgentsWorkspace }]
}
