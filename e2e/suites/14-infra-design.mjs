// 스모크 스위트 — Infra › Design — 설계본 캔버스(중첩·이유 있는 거절)·노드 문서·영속
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '14-infra-design',
  needsDb: false,
  desc: 'Infra › Design — 설계본 그리기·중첩 규칙·노드 문서(설명 없음 표식)·콜드 재시작 영속'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page

  await click('[data-nav-service="infra"]')
  await click('[data-nav-module="design"]')
  await click('[data-nav-view="diagram"]')
  await page.waitForTimeout(500)

  // ── 설계본이 없으면 만들기 CTA 가 뜬다 ─────────────────────────────────
  if ((await page.locator('[data-infra-create-design]').count()) > 0) {
    check('설계본 없음: 만들기 안내가 뜬다', true)
    await click('[data-infra-create-design]')
  }
  await page.waitForSelector('[data-infra-view="diagram"]', { timeout: 8_000 })

  // ── 종류를 골라 노드를 놓는다 ──────────────────────────────────────────
  await click('[data-add-type="aws.vpc"]')
  await page.waitForTimeout(200)
  await click('[data-add-type="aws.subnet"]')
  await page.waitForTimeout(200)
  await click('[data-add-type="aws.ec2"]')
  await page.waitForTimeout(300)
  const nodes1 = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length)
  check('캔버스: 종류를 골라 노드 3개를 놓았다', nodes1 === 3)

  // 새 노드는 종류의 기본 문서 틀을 물려받거나, 비어 있으면 '설명 없음' 표식이 붙는다.
  check('캔버스: 설명 없는 노드에 표식이 붙는다', (await page.locator('[data-undocumented]').count()) > 0)

  // ── 중첩: 허용되는 조합은 들어가고, 안 되는 조합은 이유가 뜬다 ──────────
  // 방금 놓은 EC2 가 선택돼 있다 → 부모를 VPC 로 시도(규칙 위반) → 이유가 뜬다.
  const parentSelect = page.locator('[data-infra-parent]').first()
  const options = await parentSelect.locator('option').allTextContents()
  check('캔버스: 부모 후보 목록이 뜬다', options.length >= 3)

  await parentSelect.selectOption({ label: 'VPC' })
  await page.waitForSelector('[data-infra-notice]', { timeout: 3_000 })
  const notice = await page.locator('[data-infra-notice]').innerText()
  check('중첩: EC2 를 VPC 에 바로 넣으면 거절된다', notice.includes('들어갈 수 없습니다'))
  check('중첩: 거절 이유가 넣을 수 있는 곳을 알려 준다', notice.includes('서브넷'))

  await parentSelect.selectOption({ label: '서브넷' })
  await page.waitForTimeout(300)
  await click('[data-infra-save]')
  await page.waitForTimeout(400)

  // ⚠ @xyflow 는 중첩을 DOM 포함으로 그리지 않는다(모든 노드가 형제로 절대배치된다) —
  //   그래서 화면 DOM 이 아니라 **저장된 설계본**으로 확인한다. 영속까지 함께 보는 이점도 있다.
  const graph = await page.evaluate(async () => {
    const designs = await window.rockury.infra.listDesigns()
    return window.rockury.infra.getGraph(designs[0].id)
  })
  const child = graph.nodes.find((n) => n.typeId === 'aws.ec2')
  const subnet = graph.nodes.find((n) => n.typeId === 'aws.subnet')
  check('중첩: EC2 가 서브넷 안으로 들어갔다', !!child && child.parentId === subnet?.id)
  check('중첩: 자식 좌표는 부모 기준 상대값이다', !!child && child.x >= 0 && child.y >= 0)
  check('중첩: 부모 상자가 자식을 감쌀 만큼 커졌다', !!subnet && !!child && subnet.w >= child.x + child.w)

  // ── 노드 문서: 채우면 '설명 없음' 표식이 사라진다 ───────────────────────
  await click('[data-nav-view="document"]')
  await page.waitForSelector('[data-infra-view="node-doc"]', { timeout: 5_000 })
  const emptyBefore = await page.locator('[data-doc-empty-count]').innerText()
  check('노드 문서: 설명 없는 노드 수를 세어 보여 준다', emptyBefore.includes('설명 없음'))

  await page.locator('[data-doc-node]').first().click()
  await page.waitForSelector('[data-doc-field="role"]', { timeout: 3_000 })
  await page.locator('[data-doc-field="role"]').fill('결제 웹훅 수신기')
  await page.locator('[data-doc-field="impact"]').fill('죽으면 결제가 유실된다')
  await page.locator('[data-doc-field="deps"]').fill('앞: ALB / 뒤: RDS')
  await page.waitForTimeout(200)
  await click('[data-doc-save]')
  await page.waitForTimeout(400)

  const docBody = await body()
  check('노드 문서: 정해진 칸 다섯이 다 있다', ['역할', '영향', '담당', '의존', '손대기 전'].every((t) => docBody.includes(t)))
  check('노드 문서: 설계 노드에 붙는다는 것을 화면이 알린다', docBody.includes('설계 노드'))

  // ── 저장·영속: 콜드 재시작을 넘긴다 ────────────────────────────────────
  page = await ctx.relaunch()
  await click('[data-nav-service="infra"]')
  await click('[data-nav-module="design"]')
  await click('[data-nav-view="document"]')
  await page.waitForSelector('[data-infra-view="node-doc"]', { timeout: 8_000 })
  await page.locator('[data-doc-node]').first().click()
  await page.waitForTimeout(300)
  const roleAfter = await page.locator('[data-doc-field="role"]').inputValue()
  check('콜드 재시작: 노드 문서가 남아 있다', roleAfter === '결제 웹훅 수신기')

  await click('[data-nav-view="diagram"]')
  await page.waitForTimeout(600)
  const nodesAfter = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length)
  check('콜드 재시작: 노드 3개가 다 그려진다', nodesAfter === 3)

  const readGraph = () =>
    page.evaluate(async () => {
      const designs = await window.rockury.infra.listDesigns()
      return window.rockury.infra.getGraph(designs[0].id)
    })
  const after = await readGraph()
  check(
    '콜드 재시작: 중첩 구조가 보존된다',
    after.nodes.some((n) => n.typeId === 'aws.ec2' && n.parentId)
  )

  // ── MCP 로 설계본이 읽힌다 — "구축은 밖에서" 의 반대편 짝 ──────────────
  {
    const st = await page.evaluate(() => window.rockury.ai.status())
    const hdrs = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${st.token}`
    }
    const post = (bodyObj, sid) =>
      fetch(st.url, {
        method: 'POST',
        headers: { ...hdrs, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const init = await post({
      jsonrpc: '2.0', id: 90, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-infra', version: '0' } }
    })
    const sid = init.headers.get('mcp-session-id')
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
    const call = async (name, args, id) => {
      const r = (await (await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, sid)).json()).result
      if (r?.isError) throw new Error(r.content?.[0]?.text ?? '도구 오류')
      return JSON.parse(r.content[0].text)
    }

    const names = (await (await post({ jsonrpc: '2.0', id: 91, method: 'tools/list' }, sid)).json())
      .result.tools.map((t) => t.name)
    const infraTools = names.filter((n) => n.startsWith('infra_'))
    check('MCP: infra 읽기 도구 3종이 노출된다', infraTools.length === 3)
    check(
      'MCP: 실행·쓰기 도구가 없다 — 앱이 원격 셸이 되지 않는다',
      !infraTools.some((n) => /run|save|delete|probe|exec/.test(n))
    )

    const designs = await call('infra_list_designs', {}, 92)
    check('MCP: 설계본 목록이 보인다', Array.isArray(designs) && designs.length > 0)

    const design = await call('infra_get_design', { designId: designs[0].id }, 93)
    check('MCP: 노드가 다 나온다', Array.isArray(design.nodes) && design.nodes.length === 3)
    // 이름·종류만 주면 에이전트도 "그래서 어쩌라고"가 된다 — 영향·의존이 반드시 실려야 한다.
    const hooked = design.nodes.find((n) => n.impact)
    check('CASE-iarch-053 영향(죽으면 무슨 일이 나나)이 실려 나간다', hooked?.impact === '죽으면 결제가 유실된다')
    check('CASE-iarch-053 의존이 실려 나간다', hooked?.dependsOn === '앞: ALB / 뒤: RDS')
    check('MCP: 설명이 빈 노드는 비었다고 표시된다', design.nodes.some((n) => n.documented === false))
    check('MCP: 중첩(무엇 안에 담겼나)이 이름으로 나온다', design.nodes.some((n) => n.containedIn))

    const doc = await call('infra_get_node_doc', { designId: designs[0].id, nodeName: hooked.name }, 94)
    check('MCP: 노드 문서 전문을 읽을 수 있다', doc.role === '결제 웹훅 수신기')
  }

  // ── 자동 배치가 겹 구조를 지킨다 ───────────────────────────────────────
  await click('[data-infra-autolayout]')
  await page.waitForTimeout(300)
  await click('[data-infra-save]')
  await page.waitForTimeout(400)
  const laid = await readGraph()
  const kid = laid.nodes.find((n) => n.typeId === 'aws.ec2')
  const box = laid.nodes.find((n) => n.typeId === 'aws.subnet')
  check('자동 배치: 부모-자식 관계가 유지된다', !!kid && kid.parentId === box?.id)
  check(
    '자동 배치: 자식이 부모 박스 밖으로 나가지 않는다',
    !!kid && !!box && kid.x >= 0 && kid.y >= 0 && kid.x + kid.w <= box.w && kid.y + kid.h <= box.h
  )
}
