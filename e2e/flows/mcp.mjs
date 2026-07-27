import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * AI 서비스(코드 id `mcp`) 앱 구동 흐름 — MCP 서버 프로토콜 + AI › Agents 화면.
 *
 * 새 AI 흐름은 **이 파일에만** 더한다(누적 자산 — 지우지 않는다, AGENTS.md 불변식 3).
 * 다른 서비스 흐름 파일이나 `e2e/smoke.mjs` 는 건드리지 않는다.
 */
export async function run(ctx) {
  const { check, click, body } = ctx

  // ── MCP 서버(메인 프로세스 내장) — 상태 IPC → initialize → tools/list → tools/call + 인증 거부 ──
  {
    // 접속 정보 파일을 디스크에 만들지 않는다 — 주소·키는 앱 상태 IPC 로만 얻는다.
    check('MCP: 접속 정보 파일(mcp.json) 미생성', !fs.existsSync(path.join(ctx.userData, 'mcp.json')))
    const mcpStatus = await ctx.page.evaluate(() => window.rockury.mcp.status())
    const mcp = { url: mcpStatus.url, token: mcpStatus.token }
    check('MCP: 상태 IPC — 실행 중 + 키 제공', mcpStatus.running === true && !!mcp.token)
    const mcpHeaders = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcp.token}`
    }
    const mcpPost = (bodyObj, sid) =>
      fetch(mcp.url, {
        method: 'POST',
        headers: { ...mcpHeaders, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const initRes = await mcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }
    })
    const sid = initRes.headers.get('mcp-session-id')
    const init = await initRes.json()
    check('MCP: initialize(serverInfo=rockury) + 세션 발급', init?.result?.serverInfo?.name === 'rockury' && !!sid)
    await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
    const toolNames = (await (await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json())
      .result.tools.map((t) => t.name)
    check('MCP: tools/list 읽기 도구 노출', ['list_designs', 'get_schema', 'list_versions', 'get_version'].every((n) => toolNames.includes(n)))
    const ld = await (await mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_designs', arguments: {} } }, sid)).json()
    check('MCP: list_designs → 시드 설계(commerce-core)', ld?.result?.content?.[0]?.text?.includes('commerce-core') === true)
    const noAuth = await fetch(mcp.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: mcpHeaders.accept },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })
    })
    check('MCP: 무토큰 요청 거부(401)', noAuth.status === 401)
  }

  // ── AI › Agents 화면 — 게이트웨이 상태(초록불) + 접속 키 마스킹/재발급 실 흐름 ──
  {
    await click('[data-nav-service="mcp"]')
    await ctx.page.waitForSelector('text=에이전트 게이트웨이', { timeout: 5_000 })
    check('AI 화면: 게이트웨이 열림 표시', (await body()).includes('에이전트 게이트웨이 열림'))
    const st1 = await ctx.page.evaluate(() => window.rockury.mcp.status())
    check('AI 화면: 등록 명령 생성(Claude/Codex, url 포함)',
      st1.claudeCommand?.includes(st1.url) === true && st1.codexCommand?.includes(st1.url) === true)
    // 접속 키는 기본 마스킹 — 전체 값이 화면 텍스트에 노출되지 않는다
    check('AI 화면: 접속 키 기본 마스킹', !(await body()).includes(st1.token) && (await body()).includes(st1.token.slice(-4)))
    // 재발급 실 흐름 — 확인 단계 → 진행 → 구 키 즉시 401, 새 키 발급
    await click('button:has-text("재발급")')
    await ctx.page.waitForSelector('text=다시 등록해야 해요', { timeout: 3_000 })
    await click('button:has-text("재발급 진행")')
    await ctx.page.waitForTimeout(500)
    const st2 = await ctx.page.evaluate(() => window.rockury.mcp.status())
    check('재발급: 키 교체됨', !!st2.token && st2.token !== st1.token)
    const oldKeyRes = await fetch(st2.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${st1.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/list' })
    })
    check('재발급: 구 키 즉시 무효(401)', oldKeyRes.status === 401)
    const newKeyInit = await fetch(st2.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${st2.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-rotate', version: '0' } } })
    })
    check('재발급: 새 키로 접속 성공', (await newKeyInit.json())?.result?.serverInfo?.name === 'rockury')

    // 재등록 안내(접속 키가 바뀐 뒤) — 재발급 직후 화면에 재등록 명령이 뜨고, 명령이 새 키를 담는다.
    const afterBody = await body()
    check('재등록: 재발급 직후 안내 노출(다시 등록하세요 + 재등록 복사 버튼)',
      afterBody.includes('다시 등록') && afterBody.includes('재등록 복사'))
    check('재등록: "접속 키를 바꾼 뒤" 상시 안내 노출', afterBody.includes('접속 키를 바꾼 뒤'))
    check('재등록: claude 명령이 remove→add + 새 키를 담는다',
      st2.claudeReregisterCommand?.includes('claude mcp remove rockury') === true &&
      st2.claudeReregisterCommand?.includes(`Bearer ${st2.token}`) === true)
    check('재등록: codex 명령이 remove + 새 키(env)를 담는다',
      st2.codexReregisterCommand?.includes('codex mcp remove rockury') === true &&
      st2.codexReregisterCommand?.includes(`ROCKURY_MCP_TOKEN=${st2.token}`) === true)

    await click('[data-nav-service="db"]') // 후속 DB 흐름을 위해 복귀
    await ctx.page.waitForTimeout(300)
  }
}
