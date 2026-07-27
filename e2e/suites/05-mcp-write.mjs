// 스모크 스위트 — MCP 쓰기 도구 — 에이전트 쓰기가 열린 화면에 즉시 반영(리하이드레이션)
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '05-mcp-write',
  needsDb: false,
  desc: 'MCP 쓰기 도구 — 에이전트 쓰기가 열린 화면에 즉시 반영(리하이드레이션)'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // ── MCP 쓰기 도구(2단계) — 에이전트 쓰기가 열린 화면에 즉시 반영(리하이드레이션) ──
  // CASE-mcp-072/073 (docs/qa/mcp-server.md). 토큰은 위 재발급 이후 값을 새로 조회.
  {
    const st = await page.evaluate(() => window.rockury.ai.status())
    const wHdrs = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${st.token}`
    }
    const wPost = (bodyObj, sid) =>
      fetch(st.url, {
        method: 'POST',
        headers: { ...wHdrs, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const wInit = await wPost({
      jsonrpc: '2.0', id: 41, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-write', version: '0' } }
    })
    const wSid = wInit.headers.get('mcp-session-id')
    await wPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, wSid)
    const callTool = async (name, args, id) =>
      (await (await wPost({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, wSid)).json())
        .result

    const wNames = (await (await wPost({ jsonrpc: '2.0', id: 42, method: 'tools/list' }, wSid)).json())
      .result.tools.map((t) => t.name)
    check('MCP 쓰기: tools/list 쓰기 5종 노출', ['create_design', 'update_design', 'set_schema', 'patch_schema', 'create_version'].every((n) => wNames.includes(n)))
    check('MCP 쓰기: 삭제류 도구 부재', wNames.every((n) => !/delete|remove|drop/.test(n)))

    // create_version(번호 생략 → 최신 v0.3.15 에서 patch 증가) — Versions 타임라인이 열린 채 호출.
    const cut = await callTool('create_version', { designId: 'commerce-core', note: '에이전트 컷' }, 43)
    check('MCP 쓰기: create_version 성공(v0.3.16)', cut?.isError !== true && cut?.content?.[0]?.text?.includes('v0.3.16') === true)
    await page.waitForSelector('text=v0.3.16', { timeout: 5_000 })
    check('MCP 쓰기: 타임라인 즉시 반영(v0.3.16 — 수동 재조회 없음)', (await body()).includes('v0.3.16'))

    // set_schema — Studio Definition 이 열린 채 get_schema 왕복으로 테이블 추가 → 즉시 반영.
    await click('button:has-text("Studio")')
    await click('button:has-text("Definition")')
    await page.waitForSelector('text=orders', { timeout: 5_000 })
    const gs = JSON.parse((await callTool('get_schema', { designId: 'commerce-core' }, 44)).content[0].text)
    const setRes = await callTool(
      'set_schema',
      {
        designId: 'commerce-core',
        tables: [
          ...gs.tables,
          { name: 'mcp_probe', comment: '에이전트 추가', columns: [{ name: 'id', type: 'int', nullable: false }] }
        ]
      },
      45
    )
    check('MCP 쓰기: set_schema 성공', setRes?.isError !== true)
    await page.waitForSelector('text=mcp_probe', { timeout: 5_000 })
    check('MCP 쓰기: Studio Definition 즉시 반영(mcp_probe)', (await body()).includes('mcp_probe'))

    // 쓰기 오류 규율 — 미상 설계는 프로토콜 오류가 아닌 isError + 해결 안내.
    const bad = await callTool('set_schema', { designId: 'no-such', tables: [] }, 46)
    check('MCP 쓰기: 미상 설계 isError + list_designs 안내', bad?.isError === true && bad?.content?.[0]?.text?.includes('list_designs') === true)

    // patch_schema — 전체 재전송 없이 부분 수정, 열린 화면에 즉시 반영. (spec tools.write AC-8)
    const patched = await callTool(
      'patch_schema',
      { designId: 'commerce-core', operations: [{ op: 'rename_table', table: 'mcp_probe', newName: 'mcp_patched' }] },
      47
    )
    check('MCP 쓰기: patch_schema 부분 수정 성공', patched?.isError !== true)
    await page.waitForSelector('text=mcp_patched', { timeout: 5_000 })
    check('MCP 쓰기: patch_schema 즉시 반영(mcp_patched)', (await body()).includes('mcp_patched'))

    // 저장 전 위생 검사 — 깨진 글자는 반영 0 으로 막힌다. (spec tools.write AC-9)
    const dirty = await callTool(
      'patch_schema',
      { designId: 'commerce-core', operations: [{ op: 'set_table_comment', table: 'mcp_patched', comment: '깨\uFFFD짐' }] },
      48
    )
    check(
      'MCP 쓰기: 깨진 글자는 저장 전에 차단(경로·코드포인트 안내)',
      dirty?.isError === true && dirty?.content?.[0]?.text?.includes('U+FFFD') === true
    )

    // 방언 미지정 — 앱이 "사용자에게 물어보라"고 되돌린다(에이전트가 지어내지 못하게). (spec tools.write AC-1)
    const noDialect = await callTool('create_design', { name: 'E2E 방언 미지정' }, 49)
    check(
      'MCP 쓰기: 방언 누락 시 사용자 선택 요구(생성 안 함)',
      noDialect?.isError === true && noDialect?.content?.[0]?.text?.includes('사용자에게') === true
    )
  }

}
