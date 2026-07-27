// 스모크 스위트 — AI › Agents 화면 — 게이트웨이 상태(초록불) + 접속 키 마스킹/재발급
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '02-ai-agents',
  needsDb: false,
  desc: 'AI › Agents 화면 — 게이트웨이 상태(초록불) + 접속 키 마스킹/재발급'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // ── AI › Agents 화면 — 게이트웨이 상태(초록불) + 접속 키 마스킹/재발급 실 흐름 ──
  {
    await click('[data-nav-service="mcp"]')
    await page.waitForSelector('text=에이전트 게이트웨이', { timeout: 5_000 })
    check('AI 화면: 게이트웨이 열림 표시', (await body()).includes('에이전트 게이트웨이 열림'))
    const st1 = await page.evaluate(() => window.rockury.mcp.status())
    check('AI 화면: 등록 명령 생성(Claude/Codex, url 포함)',
      st1.claudeCommand?.includes(st1.url) === true && st1.codexCommand?.includes(st1.url) === true)
    // 접속 키는 기본 마스킹 — 전체 값이 화면 텍스트에 노출되지 않는다
    check('AI 화면: 접속 키 기본 마스킹', !(await body()).includes(st1.token) && (await body()).includes(st1.token.slice(-4)))
    // 재발급 실 흐름 — 확인 단계 → 진행 → 구 키 즉시 401, 새 키 발급
    await click('button:has-text("재발급")')
    await page.waitForSelector('text=다시 등록해야 해요', { timeout: 3_000 })
    await click('button:has-text("재발급 진행")')
    await page.waitForTimeout(500)
    const st2 = await page.evaluate(() => window.rockury.mcp.status())
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
    await page.waitForTimeout(300)
  }

  // 설계 선택
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await page.waitForTimeout(300)

}
