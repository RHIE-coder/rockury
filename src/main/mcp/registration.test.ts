import { describe, expect, it } from 'vitest'
import { buildAgentCommands } from './registration'

const URL = 'http://127.0.0.1:41729/mcp'
const TOKEN = 'abc123def456'

describe('buildAgentCommands — 등록/재등록 명령 생성', () => {
  const c = buildAgentCommands(URL, TOKEN)

  it('초기 등록: url·token 이 각각 박힌다', () => {
    expect(c.claudeCommand).toContain(URL)
    expect(c.claudeCommand).toContain(`Bearer ${TOKEN}`)
    expect(c.claudeCommand).toContain('claude mcp add')
    expect(c.codexCommand).toContain(`ROCKURY_MCP_TOKEN=${TOKEN}`)
    expect(c.codexCommand).toContain('codex mcp add')
  })

  it('재등록(claude): remove 를 먼저 부른 뒤 add — 중복 등록 거부 회피', () => {
    expect(c.claudeReregisterCommand).toContain('claude mcp remove rockury')
    expect(c.claudeReregisterCommand.indexOf('remove')).toBeLessThan(c.claudeReregisterCommand.indexOf('add'))
    expect(c.claudeReregisterCommand).toContain(`Bearer ${TOKEN}`) // 새 키 반영
  })

  it('재등록(codex): remove 후 add + 새 키를 env 변수에 다시 심는다', () => {
    expect(c.codexReregisterCommand).toContain('codex mcp remove rockury')
    expect(c.codexReregisterCommand).toContain(`ROCKURY_MCP_TOKEN=${TOKEN}`)
  })

  it('키가 바뀌면 재등록 명령의 토큰도 바뀐다(스테일 토큰 재사용 방지)', () => {
    const c2 = buildAgentCommands(URL, 'newtoken999')
    expect(c2.claudeReregisterCommand).toContain('Bearer newtoken999')
    expect(c2.claudeReregisterCommand).not.toContain(TOKEN)
    expect(c2.codexReregisterCommand).toContain('ROCKURY_MCP_TOKEN=newtoken999')
  })
})
