import { Bot, Sparkles } from 'lucide-react'
import type { Service } from '@renderer/nav/types'
import { AgentsWorkspace } from './AgentsWorkspace'

/**
 * AI 서비스 — 지금은 에이전트 연동(MCP)이 유일한 기능이다(§spec ai-server.md).
 * MCP 는 이 서비스가 가진 **기능 하나**다. 서비스가 넓어지면 모듈이 늘어난다.
 *
 *   Agents — 왼쪽: 잇는다(등록 명령·접속 키) · 오른쪽: 이으면 무엇을 쓸 수 있나(열어 둔 도구)
 *
 * 도구 목록은 **일부러 모듈로 가르지 않았다.** 탭에 "Tools" 라고만 걸면 MCP 도구인지 앱의
 * 범용 유틸리티인지 구분이 안 된다(2026-07-30 사용자 지적). 연결 바로 옆에 붙어 있을 때만
 * "이으면 이걸 쓸 수 있다"는 뜻이 서므로, 한 화면 두 칸으로 둔다.
 */
export const aiService: Service = {
  id: 'ai',
  label: 'AI',
  icon: Sparkles,
  modules: [{ id: 'agents', label: 'Agents', icon: Bot, workspace: AgentsWorkspace }]
}
