// 스모크 스위트 — Migration › Logs · Environment 바인딩 · 운영↔운영 비교 · 버전 삭제
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '11-ops-misc',
  needsDb: true,
  desc: 'Migration › Logs · Environment 바인딩 · 운영↔운영 비교 · 버전 삭제'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Migration › 실행 로그 — 기준선 로그 기록(Phase 3e)
  // 탭 이름이 아니라 뷰 id 로 누른다 — 이름은 바뀐다(2026-08-12 Logs → 실행 로그).
  await click('[data-nav-view="logs"]')
  await page.waitForSelector('text=기준선', { timeout: 8_000 })
  check('Migration › 실행 로그: 기준선 로그 체인', (await body()).includes('기준선'))

  // ⭐ Environment 관리 UI — 연결 카드에서 설계 바인딩 열람(운영↔설계 결속이 화면에 드러남).
  await click('[data-nav-module="remote"]') // Connections 는 Remote 의 첫 뷰(2026-07-30)
  await click('[data-nav-view="connections"]')
  await page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  await page.locator('button[title="설계 바인딩 관리"]').first().click()
  await page.waitForSelector('text=설계 바인딩 ·', { timeout: 8_000 })
  await page.waitForSelector('text=commerce-core', { timeout: 8_000 }) // 바인딩 행 비동기 로드 대기
  check('Environment 관리: 연결의 설계 바인딩 다이얼로그(commerce-core 표시)', (await body()).includes('commerce-core'))
  await page.locator('button:has-text("닫기")').first().click()
  await page.waitForTimeout(300)

  // ⭐ 운영↔운영 비교(Compare) — 같은 DB 를 가리키는 두 번째 연결과 비교 → 스키마 동일.
  //    IPC 로 만든 연결은 렌더러 스토어(부팅 시 1회 하이드레이션)에 안 잡힘 → reload 로 반영.
  await page.evaluate(() =>
    window.rockury.connections.create({
      name: 'E2E-mysql2', dbType: 'mysql', host: 'localhost', port: 13306,
      database: 'testdb', user: 'test', password: 'test', sslEnabled: false
    })
  )
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })
  await click('button:has-text("Migration")')
  await click('[data-nav-view="compare"]')
  await page.waitForSelector('text=실 DB ↔ 실 DB', { timeout: 8_000 })
  await page.locator('[data-slot="select-trigger"]').last().click() // 상대 연결 셀렉터
  await page.locator('[data-slot="select-item"]:has-text("E2E-mysql2")').first().click()
  // `main` 안으로 좁힌다 — 탭 이름도 "비교"가 되어(2026-08-12) 그냥 누르면 탭이 잡힌다.
  await page.locator('main button:has-text("비교")').first().click()
  await page.waitForSelector('text=두 DB 의 스키마가 동일해요', { timeout: 15_000 })
  check('Migration › 비교: 같은 DB 두 연결 → 스키마 동일', (await body()).includes('두 DB 의 스키마가 동일해요'))

  // ⭐ 버전 삭제(잘못 들어간 버전 회수) — 타임라인에서 삭제 → 목록에서 사라짐.
  // Versions 는 Design 안 뷰라(2026-08-03) 설계부로 먼저 건너간다 — Migration 줄에는 없다.
  await click('[data-nav-module="design"]')
  await page.waitForTimeout(300)
  await click('button:has-text("Versions")')
  await page.waitForSelector('text=버전 타임라인', { timeout: 8_000 })
  await page.waitForTimeout(300)
  const vBeforeDel = await page.locator('[data-version-number]').count()
  const firstRow = page.locator('[data-version-number]').first()
  await firstRow.locator('button[title="버전 삭제"]').click({ force: true })
  await firstRow.locator('button:has-text("삭제")').click()
  await page.waitForTimeout(500)
  check('버전 삭제: Timeline 에서 버전 제거', (await page.locator('[data-version-number]').count()) === vBeforeDel - 1)

}
