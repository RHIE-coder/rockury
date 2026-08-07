// 스모크 스위트 — 프로젝트 범위(셸 공용) — 셀렉터 → 좁히기 → 소속 정리 → 그 자리 반영
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '60-project-scope',
  needsDb: false,
  desc: '프로젝트 범위 — 타이틀바 셀렉터로 다섯 서비스를 함께 좁히고, 소속 정리 창에서 이미 있는 것을 옮긴다'
}

export async function run(ctx) {
  const { check, body } = ctx
  const page = ctx.page
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })

  const sel = page.locator('[data-project-selector]')

  // ── 셀렉터는 타이틀바에 하나, 기본은 '전체' ──
  // 기본이 특정 프로젝트면 앱을 켜자마자 목록이 비어 보인다(도입 전 데이터는 전부 무소속).
  check('프로젝트 셀렉터가 타이틀바에 하나 있다', (await sel.count()) === 1)
  check('기본 범위는 전체', (await sel.innerText()).includes('전체'))

  // ── 도입 전 데이터는 무소속으로 시작한다 ──
  const seeded = await page.evaluate(() => window.rockury.designs.list())
  check(
    '시드 설계가 무소속으로 있다 (소급 요구 없음)',
    seeded.length > 0 && seeded.every((d) => d.project_id === null)
  )

  // 접속을 하나 만들어 둔다 — 무소속의 뜻이 설계류와 갈리는 것을 이 스위트에서 본다.
  await page.evaluate(() =>
    window.rockury.connections.create({
      name: 'e2e 로컬 Postgres',
      dbType: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'app',
      user: 'e2e',
      password: '',
      sslEnabled: false
    })
  )

  // ── 프로젝트 만들기 → 만든 것으로 옮겨 간다 ──
  await sel.click()
  await page.waitForSelector('text=새 프로젝트…', { timeout: 5_000 })
  await page.locator('text=새 프로젝트…').click()
  await page.waitForSelector('[data-project-field="name"]', { timeout: 5_000 })
  // 이름·키는 **앞 스위트가 안 쓰는 것**으로 — 20(UI/UX)이 이미 쿠팡/coupang 을 만들어 두어
  // 같은 키를 쓰면 저장소가 거절하고 "옮겨간다" 검사가 조용히 넘어졌다(2026-08-07 실측).
  await page.locator('[data-project-field="name"]').fill('마켓')
  await page.locator('[data-project-field="key"]').fill('market')
  await page.locator('button[type="submit"]:has-text("만들기")').click()
  await page.waitForTimeout(600)
  check('만든 프로젝트로 범위가 옮겨간다', (await sel.innerText()).includes('마켓'))

  // ── 좁혀졌다: 무소속 설계는 셀렉터에서 숨는다(strict) ──
  await page.locator('text=Design').first().click()
  await page.waitForTimeout(400)
  check('프로젝트를 고르면 무소속 설계는 숨는다', (await body()).includes('설계를 선택하세요'))

  // ── 소속 정리 창 — 이미 있는 것을 프로젝트로 옮긴다 ──
  // 이 자리가 없으면 기능이 반쪽이다: 도입 전에 만든 것은 영원히 무소속으로 남는다.
  await sel.click()
  await page.waitForSelector('text=소속 정리…', { timeout: 5_000 })
  await page.locator('text=소속 정리…').click()
  await page.waitForSelector('text=소속 정리', { timeout: 5_000 })

  const dialogText = await body()
  check('소속 정리 창이 DB 설계·DB 접속을 함께 다룬다', dialogText.includes('DB 설계') && dialogText.includes('DB 접속'))
  // 무소속의 뜻이 종류마다 다르다 — 접속은 '공용'(어디서나 보임), 설계는 '없음'.
  check('접속의 무소속은 공용으로 표시된다', dialogText.includes('공용'))

  await page.locator('section:has(h3:text("DB 설계")) li').first().locator('button').click()
  await page.waitForTimeout(300)
  await page.locator('[role="menuitem"]:has-text("마켓")').first().click()
  await page.waitForTimeout(500)

  const moved = await page.evaluate(() => window.rockury.designs.list())
  check('소속 정리에서 설계가 프로젝트로 옮겨진다', moved.some((d) => d.project_id !== null))

  await page.locator('[role="dialog"] button:has-text("닫기")').click()
  await page.waitForTimeout(600)

  // ── 옮긴 결과가 그 자리에서 서비스 목록에 반영된다 ──
  // 회귀(2026-08-04 실측): 저장소만 바뀌고 서비스 스토어가 든 사본은 옛 소속이라, 프로젝트로
  // 옮긴 설계가 셀렉터에 계속 안 나타났다. 셸이 보내는 변경 신호로 다시 읽게 고쳤다.
  await page.locator('text=설계 선택').first().click()
  await page.waitForTimeout(400)
  check('옮긴 설계가 그 자리에서 셀렉터 목록에 나타난다', (await body()).includes(moved[0].name))
  await page.keyboard.press('Escape')

  // ── 프로젝트를 지워도 설계는 살아남는다(무소속으로 되돌아온다) ──
  // 프로젝트는 이름표일 뿐이고 설계는 그보다 무거운 산출물이다.
  // **이 스위트가 만든 것**을 지운다 — 앞 스위트(20)가 만든 프로젝트도 목록에 있어서
  // 첫 항목을 집으면 엉뚱한 것을 지우고, 옮겨 둔 설계의 소속이 안 풀린다.
  const projects = await page.evaluate(() => window.rockury.projects.list())
  const mine = projects.find((p) => p.key === 'market') ?? projects[0]
  await page.evaluate((id) => window.rockury.projects.remove(id), mine.id)
  await page.waitForTimeout(400)
  const survived = await page.evaluate(() => window.rockury.designs.list())
  check(
    '프로젝트를 지워도 설계는 남고 소속만 풀린다',
    survived.length === moved.length && survived.every((d) => d.project_id === null)
  )

}
