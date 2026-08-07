// 스모크 스위트 — 범위(scope): 한 연결에서 여러 database 를 보고, 범위 밖 참조를 표현한다.
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 정본: docs/spec/db-remote.md §db-remote.scope. 이 스위트가 못박는 것 —
//   ⑴ 범위 칸이 운영 손잡이(뷰 탭 줄 오른쪽 끝) 안에 뜨고, **고른 이름**을 말한다(예전엔 "기본" 이라 적어 사용자가 못 찾았다)
//   ⑵ database 여러 개를 켜면 한 화면에 다 들어오고, 동명 테이블이 서로를 안 덮는다
//   ⑶ 노드 id 가 스키마를 달고 나온다(안 그러면 뒤엣것이 앞엣것을 덮어 테이블이 사라진다)
//   ⑷ 한쪽을 끄면 그리로 가던 FK 가 **범위 밖 카드**로 남는다(선이 허공에서 끊기지 않는다)
//
// 앞 스위트(06)가 만든 MySQL 연결을 그대로 쓴다 — 이 파일은 손잡이만 조작한다.
// test-db 전제: MySQL 에 service1/service2/service3 이 있고 service2.orders 가
// service1.customers 와 service3.carriers 를 가리킨다(scripts/test-db/init/mysql/zz-scope.sql).

export const meta = {
  name: '51-db-scope',
  needsDb: true,
  desc: '범위(scope) — 여러 database 를 한 화면에 · 스키마 묶음 · 범위 밖 참조 카드'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  await click('[data-nav-service="db"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(300)
  // 모듈만 누르면 **마지막에 보던 뷰**로 열린다(`nav/recall`) — 앞 스위트가 Connections 에 두고
  // 나가면 범위 손잡이가 없는 화면에서 재게 된다. 범위를 쓰는 화면을 짚는다.
  await click('[data-nav-view="definition"]')
  await page.waitForTimeout(400)

  // 06 이 만든 MySQL 연결을 **실제로 고른다** — 머리말이 그렇게 적어 두었지만 고르지는 않고
  // 있었다. 그 사이 12(연결 실패 알림)가 활성 연결을 죽은 PostgreSQL 로 바꿔 놓아, 범위 목록이
  // 영영 안 떴다(2026-08-07 실측).
  await page.evaluate(async () => {
    const conn = (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql')
    if (conn) window.__rockuryNav.setContextValue('conn', conn.id)
  })
  await page.waitForTimeout(900)

  check('범위: 운영 손잡이 안에 있다', (await page.locator('[data-area-handle="ops"] [data-scope-selector]').count()) === 1)

  /** 손잡이를 열고 그 스키마 항목을 누른다(누를 때마다 다시 읽으므로 창은 열린 채로 둔다). */
  const toggle = async (schema) => {
    await page.locator('[data-scope-selector]').first().click()
    await page.waitForSelector(`[data-scope-schema="${schema}"]`, { timeout: 10_000 })
    await page.locator(`[data-scope-schema="${schema}"]`).first().click()
    await page.waitForTimeout(900) // 저장 + 재역설계
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // ── ⑵ database 를 더 켠다 ────────────────────────────────────
  for (const s of ['service1', 'service2', 'service3']) await toggle(s)

  const handle = (await page.locator('[data-scope-selector]').first().innerText()).trim()
  check(`범위: 손잡이가 고른 이름을 말한다("기본" 같은 말이 아니라) — "${handle}"`, !handle.includes('기본'))

  await click('button:has-text("Definition")')
  await page.waitForTimeout(1500)
  const defText = await body()
  check(
    '범위: 여러 database 의 테이블이 한 목록에 들어온다',
    defText.includes('customers') && defText.includes('orders') && defText.includes('carriers')
  )
  const rows = await page.$$eval('[data-table-row]', (els) => els.map((e) => e.getAttribute('data-table-row')))
  check(
    `범위: 동명 테이블(members)이 database 별로 둘 다 산다 (전체 ${rows.length}행)`,
    rows.filter((n) => n === 'members').length === 2
  )

  // ── ⑶ 노드 id 에 스키마가 실린다 · 교차 database 관계 ──────────
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node[data-id^="t:"]', { timeout: 20_000 })
  await page.waitForTimeout(900)
  const ids = await page.$$eval('.react-flow__node[data-id^="t:"]', (els) =>
    els.map((e) => e.getAttribute('data-id'))
  )
  check(
    `범위: 노드 id 가 스키마를 달고 나온다 (${ids.filter((i) => i.includes('service')).slice(0, 2).join(', ')})`,
    ids.some((id) => id === 't:service1.customers') && ids.some((id) => id === 't:service2.orders')
  )
  check('범위: 교차 database 관계가 선으로 그려진다', (await page.locator('.react-flow__edge').count()) > 0)
  check('범위: 다 켠 상태에선 범위 밖 카드가 없다', (await page.locator('[data-outside-node]').count()) === 0)

  // ── ⑷ 하나를 끄면 그리로 가던 FK 가 밖 카드로 남는다 ────────────
  await toggle('service3')
  await page.waitForTimeout(1200)
  const outside = await page.$$eval('[data-outside-node]', (els) =>
    els.map((e) => e.getAttribute('data-outside-node'))
  )
  check(
    `범위: 끈 database 를 가리키는 FK 가 범위 밖 카드로 남는다 (${outside.join(', ') || '없음'})`,
    outside.includes('service3.carriers')
  )
  check('범위: 밖 카드가 켤 수 있다고 알린다', (await body()).includes('범위에 더하기'))

  // 뒷정리 — 범위를 원래대로(뒤 스위트가 testdb 만 보는 것을 전제한다).
  // ⚠ 순서가 중요하다: **마지막 하나는 끌 수 없으므로**(scope.selector AC-3) 먼저 testdb 를 켜고
  //   그다음 service1·2 를 끈다. 반대로 하면 마지막 항목이 잠겨 클릭이 30초 대기 끝에 죽는다.
  await toggle('testdb')
  for (const s of ['service1', 'service2']) await toggle(s)
  check(
    '범위: 뒷정리 후 testdb 하나만 남는다',
    (await page.locator('[data-scope-selector]').first().innerText()).includes('testdb')
  )
}
