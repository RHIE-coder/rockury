// 스모크 스위트 — UI/UX › Screens: 위계(프로젝트›앱›서비스›화면) 만들기 + 구조 편집 + 미리보기 + 끌어놓기
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '13-uiux-spec',
  needsDb: false,
  desc: 'UI/UX — 위계·구조 · 미리보기 · 끌어놓기 · 토큰 · 의견(핀) · MCP 한 바퀴 · 능력 인덱스'
}

/**
 * 노드 만들기 모달을 채우고 만든다. 층마다 같은 폼이라 한 함수로 쓴다(앱 코드와 같은 이유).
 *
 * ⚠ **모달 안 버튼은 다이얼로그 스코프 + 정확 일치(`:text-is`)로 겨냥한다.** `has-text` 는
 * 부분 일치라 사이드바의 `첫 앱 만들기` 버튼이 "만들기" 로 먼저 잡히고(DOM 순서상 모달보다 앞),
 * 모달이 열린 동안 그 버튼은 클릭 불가라 30초를 기다리다 죽는다 — 전체 실행에서만 드러난 실측.
 * `expectStay` 는 거절을 확인하는 경우(모달이 열린 채 남아야 한다).
 */
async function fillNode(page, { name, key, expectStay = false }) {
  await page.waitForSelector('[data-node-field="name"]', { timeout: 5_000 })
  await page.fill('[data-node-field="name"]', name)
  await page.fill('[data-node-field="key"]', key)
  await page.click('[role="dialog"] button:text-is("만들기")')
  if (expectStay) {
    await page.waitForTimeout(400)
    return
  }
  await settle(page)
}

/** 모달을 취소로 닫고 닫힘까지 기다린다(위와 같은 이유). */
async function dismissNode(page) {
  await page.click('[role="dialog"] button:text-is("취소")')
  await settle(page)
}

/**
 * 모달이 완전히 걷힐 때까지 기다린다. Radix 는 모달이 열린 동안 `body` 에
 * `pointer-events:none` 을 걸고 닫힐 때 푼다 — 그게 풀리기 전에 다음 클릭을 하면
 * 요소가 보이는데도 30초를 기다리다 죽는다(전체 실행에서만 드러난 실측 함정).
 */
async function settle(page) {
  await page.waitForSelector('[data-node-field="name"]', { state: 'detached', timeout: 5_000 })
  await page.waitForFunction(() => document.body.style.pointerEvents !== 'none', undefined, {
    timeout: 5_000
  })
  await page.waitForTimeout(400)
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  // 앞 스위트가 모달을 열어 둔 채 끝났을 수 있다 — 오버레이가 남으면 클릭이 전부 막힌다.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // ── UI/UX 서비스 → Screens › Spec ──
  await click('[data-nav-service="uiux"]')
  await page.waitForTimeout(200)
  await click('[data-nav-module="screens"]')
  await click('[data-nav-view="spec"]')
  await page.waitForTimeout(300)
  check('Spec: 프로젝트 없으면 고르라고 안내', (await body()).includes('프로젝트를 고르세요'))

  // ── 프로젝트 만들기 (빈 상태 CTA) ──
  await click('button:has-text("새 프로젝트")')
  await fillNode(page, { name: '쿠팡', key: 'coupang' })
  await page.waitForSelector('text=첫 앱 만들기', { timeout: 5_000 })
  check('Spec: 프로젝트를 만들면 바로 그 프로젝트를 본다', (await body()).includes('첫 앱 만들기'))

  // ── 앱 → 서비스 → 화면 ──
  await click('text=첫 앱 만들기')
  await fillNode(page, { name: '이용자 앱', key: 'buyer' })
  await page.waitForTimeout(300)
  check('Spec: 앱이 위계 트리에 나온다', (await body()).includes('이용자 앱'))

  // 서비스 추가 — 앱 줄의 + (호버로 드러나는 액션이라 title 로 집는다)
  await click('button[title="서비스 추가"]')
  await fillNode(page, { name: '로그인', key: 'auth' })
  await page.waitForTimeout(300)
  check('Spec: 서비스가 앱 아래 나온다', (await body()).includes('로그인'))

  await click('button[title="화면 추가"]')
  await fillNode(page, { name: '로그인 화면', key: 'login' })
  await page.waitForTimeout(300)
  check('Spec: 화면이 서비스 아래 나온다', (await body()).includes('로그인 화면'))

  // ── 주소 유일성(INV-1) — 같은 자리에 같은 주소 조각은 거절된다 ──
  await click('button[title="화면 추가"]')
  await fillNode(page, { name: '중복 화면', key: 'login', expectStay: true })
  check('Spec: 같은 자리 주소 중복은 거절하고 이유를 보인다', (await body()).includes('이미 있습니다'))
  await dismissNode(page)

  // ── 화면 고르기 → 구조 편집 ──
  await click('text=로그인 화면')
  await page.waitForTimeout(300)
  check('Spec: 화면을 고르면 구조가 빈 상태로 열린다', (await body()).includes('아직 비어 있어요'))

  // 안정 주소 = 네 층의 주소 조각을 이은 것
  const address = await page.locator('[data-testid="uiux-address"]').first().innerText()
  check('Spec: 안정 주소가 층을 이어 만들어진다', address.trim() === 'coupang.buyer.auth.login')

  // 영역 추가
  await click('button[title="영역 추가"]')
  await page.waitForSelector('[data-spec-section]', { timeout: 5_000 })
  check('Spec: 영역이 추가된다', (await page.locator('[data-spec-section]').count()) === 1)

  // 요소 추가 — 종류를 골라 넣는다
  await click('button:has-text("요소 추가")')
  await page.waitForSelector('button:text-is("입력칸")', { timeout: 5_000 })
  await click('button:text-is("입력칸")')
  await page.waitForSelector('[data-spec-component="input"]', { timeout: 5_000 })
  await click('button:has-text("요소 추가")')
  await click('button:text-is("버튼")')
  await page.waitForSelector('[data-spec-component="button"]', { timeout: 5_000 })
  check('Spec: 요소 두 개가 순서대로 들어간다', (await page.locator('[data-spec-component]').count()) === 2)
  check('Spec: 요소 id 는 종류에서 딴다(사람이 읽는 손잡이)', (await page.locator('[data-spec-component="input"]').count()) === 1)

  // ── 속성 — 요소를 고르면 그 요소 칸이 열린다 ──
  await click('[data-spec-component="input"]')
  await page.waitForTimeout(250)
  check('Spec: 요소를 고르면 속성이 요소로 바뀐다', (await body()).includes('이름표'))

  // ── 저장 잔존 — 다른 모듈에 갔다 와도 남는다(내용이 실제로 저장됐다는 뜻) ──
  await click('[data-nav-module="flows"]')
  await page.waitForTimeout(250)
  await click('[data-nav-module="screens"]')
  await click('[data-nav-view="spec"]')
  await page.waitForTimeout(400)
  await click('text=로그인 화면')
  await page.waitForTimeout(300)
  check('Spec: 화면을 떠났다 와도 구조가 남는다', (await page.locator('[data-spec-component]').count()) === 2)

  // ── Canvas — 같은 화면이 실제 화면으로 그려진다 (미리보기는 그림자 뿌리 안이라 로케이터가 뚫고 본다) ──
  await click('[data-nav-view="canvas"]')
  await page.waitForSelector('[data-uiux-preview]', { timeout: 5_000 })
  await page.waitForTimeout(400)
  check('Canvas: 고른 화면이 미리보기로 그려진다', (await page.locator('[data-uiux-preview] input').count()) === 1)
  check(
    'Canvas: 조각이 토큰 변수로 그려진다(하드코딩 아님)',
    (
      await page.locator('[data-uiux-preview] input').first().evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--t-color-primary').trim()
      )
    ).length > 0
  )
  check('Canvas: 뷰포트 폭을 헤더에 알린다', (await body()).includes('1160px'))

  // 위계·속성은 뷰를 바꿔도 그대로다 — 셸을 공유한다는 뜻(같은 것을 다른 방식으로 본다).
  check('Canvas: 뷰를 바꿔도 위계가 남는다', (await body()).includes('이용자 앱'))

  // ── Canvas — 눌러서 고르기 ──
  {
    const box = await page.locator('[data-uiux-node="input"]').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(300)
    check('Canvas: 미리보기에서 요소를 누르면 속성이 열린다', (await body()).includes('이름표'))
  }

  // ── Canvas — 끌어서 순서 바꾸기 (저장되는 건 좌표가 아니라 순서다) ──
  {
    const from = await page.locator('[data-uiux-node="input"]').boundingBox()
    const to = await page.locator('[data-uiux-node="button"]').boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // 중간 지점을 여러 번 지나야 포인터 이동이 실제로 발생한다.
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 12 })
    await page.waitForTimeout(150)
    check('Canvas: 끄는 동안 놓을 자리를 선으로 보인다', (await page.locator('[data-uiux-guide]').count()) === 1)
    await page.mouse.up()
    await page.waitForTimeout(400)
    check('Canvas: 놓으면 표시가 사라진다', (await page.locator('[data-uiux-guide]').count()) === 0)
  }

  // 바뀐 순서는 구조에도 그대로 — 두 화면이 같은 함수를 쓴다는 뜻.
  await click('[data-nav-view="spec"]')
  await page.waitForTimeout(400)
  check(
    'Canvas: 끌어 옮긴 순서가 구조에 반영된다',
    JSON.stringify(
      await page
        .locator('[data-spec-component]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-spec-component')))
    ) === JSON.stringify(['button', 'input'])
  )

  // ── 지우기 — 요소 하나를 지우면 그것만 사라진다 ──
  await page.locator('[data-spec-component="button"] span[title="요소 지우기"]').click()
  await page.waitForTimeout(300)
  check('Spec: 요소를 지우면 그것만 사라진다', (await page.locator('[data-spec-component]').count()) === 1)

  // ── Style — 토큰을 바꾸면 미리보기가 따라 바뀐다 (Style 이 있는 이유) ──
  await click('[data-nav-module="style"]')
  await click('[data-nav-view="tokens"]')
  await page.waitForSelector('[data-uiux-token="color.primary"]', { timeout: 5_000 })
  check('Style: 처음엔 전부 기본값이다', (await page.locator('[data-uiux-token-changed="0"]').count()) === 1)
  await page.fill('[data-uiux-token="color.primary"] input', '#0f766e')
  await page.waitForTimeout(500)
  check('Style: 바꾼 토큰 수를 알려준다', (await page.locator('[data-uiux-token-changed="1"]').count()) === 1)

  await click('[data-nav-view="components"]')
  await page.waitForTimeout(400)
  check('Style: 컴포넌트를 종류별로 늘어놓는다', (await body()).includes('입력칸') && (await body()).includes('버튼'))

  // 진짜 확인 — 미리보기가 그 색을 쓴다.
  await click('[data-nav-module="screens"]')
  await click('[data-nav-view="canvas"]')
  await page.waitForSelector('[data-uiux-preview]', { timeout: 5_000 })
  await page.waitForTimeout(500)
  check(
    'Style: 바꾼 토큰이 미리보기에 그대로 들어간다',
    (await page.locator('[data-uiux-node="input"]').first().evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--t-color-primary').trim()
    )) === '#0f766e'
  )

  // ── Review — 화면 위 요소에 의견을 남긴다 (스크린샷 + 화살표를 대신하는 자리) ──
  await click('[data-nav-view="review"]')
  await page.waitForSelector('[data-uiux-review]', { timeout: 5_000 })
  await page.waitForTimeout(400)
  check('Review: 고른 화면이 미리보기로 뜬다', (await page.locator('[data-uiux-review] input').count()) === 1)

  // 요소를 눌러 고른 뒤 그 요소에 의견을 남긴다.
  {
    const box = await page.locator('[data-uiux-node="input"]').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(250)
    check('Review: 요소를 고르면 어디에 남기는지 알려준다', (await body()).includes('에 남깁니다'))
    await page.fill('[data-uiux-note-input]', '이 입력칸 라벨을 "이메일 주소"로 바꿔 주세요')
    await click('button:text-is("남기기")')
    await page.waitForSelector('[data-uiux-note]', { timeout: 5_000 })
    check('Review: 의견이 목록에 쌓인다', (await page.locator('[data-uiux-note]').count()) === 1)
    check('Review: 의견이 붙은 요소를 미리보기에 표시한다', (await page.locator('[data-uiux-node="input"]').evaluate((el) => getComputedStyle(el).outlineStyle)) === 'dashed')
  }

  // ── MCP — 에이전트가 읽고 확인 결과를 되돌려 적는다 (이 서비스의 목적, §8) ──
  // 사람이 만들고 → 에이전트가 읽고 판정하고 → 앱이 보여주는 한 바퀴를 통째로 확인한다.
  const mcp = await page.evaluate(async () => {
    const st = await window.rockury.ai.status()
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${st.token}`
    }
    const post = (bodyObj, sid) =>
      fetch(st.url, {
        method: 'POST',
        headers: { ...headers, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const init = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'uiux-smoke', version: '0' } }
    })
    const sid = init.headers.get('mcp-session-id')
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
    const call = async (name, args, id) =>
      (await (await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, sid)).json())
        .result

    const names = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json())
      .result.tools.map((t) => t.name)
    const tree = JSON.parse((await call('get_ui_tree', { project: 'coupang' }, 3)).content[0].text)
    const surface = JSON.parse(
      (await call('get_ui_surface', { address: 'coupang.buyer.auth.login' }, 4)).content[0].text
    )
    const wrote = await call(
      'set_ui_surface_status',
      { address: 'coupang.buyer.auth.login', status: 'verified', by: 'e2e', note: '스모크에서 확인' },
      5
    )
    const missing = await call('get_ui_surface', { address: 'coupang.없는.주소.임' }, 6)
    const tokens = JSON.parse((await call('get_ui_tokens', { project: 'coupang' }, 10)).content[0].text)
    const setTokens = JSON.parse(
      (await call('set_ui_tokens', { project: 'coupang', tokens: { 'space.md': '20px' } }, 11)).content[0].text
    )
    const notes = JSON.parse((await call('list_ui_notes', { project: 'coupang' }, 7)).content[0].text)
    const resolved = await call('resolve_ui_note', { id: notes[0]?.id }, 8)
    const afterResolve = JSON.parse((await call('list_ui_notes', { project: 'coupang' }, 9)).content[0].text)
    return { names, tree, surface, wrote, missing, notes, resolved, afterResolve, tokens, setTokens }
  })

  check(
    'MCP: ui 도구가 읽기·쓰기 모두 노출된다',
    ['list_ui_projects', 'get_ui_tree', 'get_ui_surface', 'create_ui_node', 'set_ui_surface', 'set_ui_surface_status'].every(
      (n) => mcp.names.includes(n)
    )
  )
  check('MCP: 삭제류 ui 도구는 없다 (파괴적 조작은 사람이 앱에서만)', mcp.names.every((n) => !/^(delete|remove)_ui/.test(n)))
  check(
    'MCP: get_ui_tree 가 안정 주소로 위계를 준다',
    mcp.tree.applications[0].services[0].surfaces[0].address === 'coupang.buyer.auth.login'
  )
  check('MCP: get_ui_surface 가 화면 구조를 준다', Array.isArray(mcp.surface.content.sections) && mcp.surface.content.sections.length === 1)
  check('MCP: set_ui_surface_status 로 확인 결과를 적는다', mcp.wrote?.isError !== true)
  check(
    'MCP: 없는 주소는 프로토콜 오류가 아니라 안내로 돌려준다',
    mcp.missing?.isError === true && mcp.missing.content[0].text.includes('get_ui_tree')
  )

  check(
    'MCP: 사람이 바꾼 토큰을 에이전트가 읽는다 (실제 코드의 토큰과 맞추라고)',
    mcp.tokens.overrides['color.primary'] === '#0f766e'
  )
  check(
    'MCP: set_ui_tokens 는 준 값만 바꾸고 나머지는 그대로 둔다',
    mcp.setTokens.overrides['space.md'] === '20px' && mcp.setTokens.overrides['color.primary'] === '#0f766e'
  )
  check(
    'MCP: 사람이 남긴 의견을 에이전트가 읽는다 (좌표가 아니라 요소에 붙어 온다)',
    mcp.notes.length === 1 && mcp.notes[0].target === 'input' && mcp.notes[0].body.includes('이메일 주소')
  )
  check('MCP: 반영한 의견을 해결로 넘긴다', mcp.resolved?.isError !== true && mcp.afterResolve.length === 0)

  // ── Features — 에이전트가 적은 것이 능력 인덱스에 나타난다 (한 바퀴 완성) ──
  await click('[data-nav-module="features"]')
  await page.waitForTimeout(600)
  check('Features: 제품 이름과 능력 인덱스가 보인다', (await body()).includes('쿠팡') && (await body()).includes('이용자 앱'))
  check('Features: 에이전트가 적은 확인이 집계에 반영된다', (await page.locator('[data-uiux-progress="1"]').count()) === 1)
  check('Features: 화면 목록에서 설계로 건너뛸 수 있다', (await page.locator('[data-uiux-feature-surface]').count()) === 1)
}
