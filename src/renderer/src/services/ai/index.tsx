import { Bot, Sparkles, Wrench } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { AgentsWorkspace } from './AgentsWorkspace'
import { ToolsWorkspace } from './ToolsWorkspace'

/**
 * AI 서비스 — 지금은 에이전트 연동(MCP)이 유일한 기능이다(§spec ai-server.md).
 * MCP 는 이 서비스가 가진 **기능 하나**다. 서비스가 넓어지면 모듈이 늘어난다.
 *
 *   Agents — 잇는다(등록 명령 복사 + 접속 키 관리)
 *   Tools  — 이어 놓으면 무엇을 할 수 있나(서비스별 도구 목록)
 *
 * 순서가 곧 사용자의 순서다. 둘 다 depth 2 단일 워크스페이스.
 */
export const aiService: Service = {
  id: 'ai',
  label: 'AI',
  icon: Sparkles,
  modules: [
    { id: 'agents', label: 'Agents', icon: Bot, workspace: AgentsWorkspace },
    { id: 'tools', label: 'Tools', icon: Wrench, workspace: ToolsWorkspace }
  ]
}
