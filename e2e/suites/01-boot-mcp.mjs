// 스모크 스위트 — 부팅 + MCP 서버(메인 프로세스 내장) — 상태 IPC → initialize → tools/list → tools/call + 인증 거부
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '01-boot-mcp',
  needsDb: false,
  desc: '부팅 + MCP 서버(메인 프로세스 내장) — 상태 IPC → initialize → tools/list → tools/call + 인증 거부'
}

export async function run(ctx) {
  const { check, body, USER_DATA, fs, path } = ctx
  let page = ctx.page
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  check('앱 부팅 + DB 서비스 셸 렌더', (await body()).includes('Studio'))

  // ── MCP 서버(메인 프로세스 내장) — 상태 IPC → initialize → tools/list → tools/call + 인증 거부 ──
  {
    // 접속 정보 파일을 디스크에 만들지 않는다 — 주소·키는 앱 상태 IPC 로만 얻는다.
    check('MCP: 접속 정보 파일(mcp.json) 미생성', !fs.existsSync(path.join(USER_DATA, 'mcp.json')))
    const mcpStatus = await page.evaluate(() => window.rockury.mcp.status())
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

}
