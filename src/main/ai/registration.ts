/**
 * 에이전트 등록 명령 생성 — 순수 문자열(electron 미의존 테스트 seam, http.ts/tools.ts 와 같은 관례).
 * 초기 등록(add)과 접속 키가 바뀐 뒤의 재등록(remove→add)을 함께 만든다.
 *
 * 재등록에 remove 를 앞세우는 이유: 이미 등록된 이름으로 `mcp add` 를 다시 부르면 CLI 가
 * 중복으로 거부할 수 있다(claude/codex 모두 공식 문서 미명시) — remove 후 add 가 안전한 표준.
 * ';' 로 이어 remove 가 실패(미등록)해도 add 가 이어진다.
 */

const SERVER = 'rockury'
const ENV = 'ROCKURY_MCP_TOKEN'

export interface AgentCommands {
  claudeCommand: string
  codexCommand: string
  claudeReregisterCommand: string
  codexReregisterCommand: string
}

export function buildAgentCommands(url: string, token: string): AgentCommands {
  const claudeAdd = `claude mcp add --transport http ${SERVER} ${url} --header "Authorization: Bearer ${token}"`
  // codex CLI(0.144 실측)는 토큰 직접 플래그가 없고 env 변수 참조만 받는다 —
  // 셸 프로필 영속 + 현재 셸 반영 + 등록을 한 줄로(붙여넣기 전 전부 보이는 투명한 형태).
  const codexAdd = `echo 'export ${ENV}=${token}' >> ~/.zshrc && export ${ENV}=${token} && codex mcp add ${SERVER} --url ${url} --bearer-token-env-var ${ENV}`
  return {
    claudeCommand: claudeAdd,
    codexCommand: codexAdd,
    claudeReregisterCommand: `claude mcp remove ${SERVER} ; ${claudeAdd}`,
    // codex 는 토큰을 env 변수로 참조하므로 사실 새 키를 그 변수에 넣기만 하면 된다(등록 정보 불변) —
    // 그래도 remove→add 로 등록까지 깨끗이 다시 세워 "무조건 되는" 경로를 준다(위 codexAdd 가 env 도 갱신).
    codexReregisterCommand: `codex mcp remove ${SERVER} ; ${codexAdd}`
  }
}
