import { AppShell } from './shell/AppShell'
import { subscribeAgentActivity } from './shell/agentActivityBridge'

// 앱이 뜰 때 한 번 — 에이전트(MCP)가 어느 서비스를 고쳤는지 레일이 듣기 시작한다.
// 서비스 화면이 아직 안 열려 있어도 켜져 있어야 해서 여기(항상 도는 자리)에 둔다.
subscribeAgentActivity()

export default function App() {
  return <AppShell />
}
