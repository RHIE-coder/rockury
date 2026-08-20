// 스모크 스위트 — Grant 탭: 계정 현황 · 층 배지 · 세트 저장 · 대조 · 적용 안전장치.
// 실행: `npm run e2e`(러너가 순서대로 부른다). ⚠ 접근성 쿼리 금지 → CSS/text 로케이터만.
//
// 이 스위트가 못박는 것 (QA S9 · CASE-remote-07A~07E)
//   ⑴ 관리자 연결에서 계정 목록 + 객체×권한 표의 층 배지 (07A)
//   ⑵ 일반 계정 연결은 오류가 아니라 "못 본다" 경고 + 자기 권한 (07B)
//   ⑶ 세트 저장 → 목록에 뜬다 (07C)
//   ⑷ 대조 — 모자람이 갈라 보이고 양쪽 개수가 찍힌다 (07D)
//   ⑸ 적용 바 — 미리보기가 먼저, REVOKE 기본 꺼짐, 승인 전 무실행 (07E)
//   ⑹ SQLite 연결은 본문 한 줄 (vendor AC-4)
//
// 픽스처 계정(rky_grants: SELECT 만, INSERT 없음)은 root 연결로 이 스위트가 직접 심고 지운다 —
// 도커 init 스크립트에 넣으면 이미 떠 있는 컨테이너에 반영이 안 된다(재생성 필요).
// 실 GRANT 실행(승인 뒤)은 여기서 안 덮는다 — 스모크 DB 권한이 오염되면 뒤 스위트의 픽스처
// 전제가 깨진다. 실행의 정확성은 CASE-remote-077·078·079(vitest·통합)가 고정한다.

export const meta = {
  name: '53-db-grants',
  needsDb: true,
  desc: 'Grant 탭 — 계정 현황·층 배지·세트·대조·적용 안전장치'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  // ── 준비 ─────────────────────────────────────────────────────────────────
  // root 연결은 **UI 로** 만든다 — preload API 로 만들면 이 창의 연결 스토어가 모르는 id 가 되어
  // 컨텍스트 셀렉터가 활성화하지 못한다(다른 창에만 알림이 간다, 2026-08-09 실측).
  await click('[data-nav-service="db"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(300)
  const rootExists = await page.evaluate(async () =>
    (await window.rockury.connections.list()).some((c) => c.name === 'E2E-mysql-root'))
  if (!rootExists) {
    await click('[data-nav-view="connections"]')
    await page.waitForTimeout(300)
    await click('button:has-text("새 연결")')
    await page.waitForSelector('text=연결 이름', { timeout: 5_000 })
    await page.locator('input[placeholder*="운영 DB"]').fill('E2E-mysql-root')
    await page.locator('input[placeholder="3306"]').fill('13306')
    await page.locator('input[placeholder="testdb"]').fill('testdb')
    await page.locator('input[placeholder="test"]').fill('root')
    await page.locator('input[type="password"]').fill('root')
    await click('button[type="submit"]:has-text("연결 만들기")')
    await page.waitForSelector('text=E2E-mysql-root', { timeout: 5_000 })
  }
  // 픽스처 계정(SELECT 만 — 대조가 "모자람"을 낼 재료) + 세트 잔재 청소(재실행 안전)
  const rootId = await page.evaluate(async () => {
    const root = (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql-root')
    for (const s of await window.rockury.grantSets.list())
      if (s.name === 'E2E-읽기') await window.rockury.grantSets.delete(s.id)
    await window.rockury.query.run(root.id, "DROP USER IF EXISTS 'rky_grants'@'%'")
    await window.rockury.query.run(root.id, "CREATE USER 'rky_grants'@'%' IDENTIFIED BY 'rky_grants_pw'")
    await window.rockury.query.run(root.id, "GRANT SELECT ON `testdb`.`users` TO 'rky_grants'@'%'")
    return root.id
  })

  try {
    await click('[data-nav-view="grants"]')
    await page.waitForTimeout(300)
    await page.evaluate((id) => window.__rockuryNav.setContextValue('conn', id), rootId)
    await page.waitForTimeout(1200) // 권한 + 스키마 재역설계

    // ── 07A: 관리자 — 계정 목록 · 층 배지 ─────────────────────────────────────
    await page.waitForSelector('[data-grant-account="rky_grants@%"]', { timeout: 15_000 })
    check('07A 관리자: 픽스처 계정이 목록에 뜬다', true)
    check('07A 접속 중 배지', (await body()).includes('접속 중'))

    await click('[data-grant-account="rky_grants@%"]')
    await page.waitForSelector('[data-grant-row="users"]', { timeout: 10_000 })
    const usersRow = await page.locator('[data-grant-row="users"]').innerText()
    check('07A 객체×권한 표: users 에 테이블 층 배지', usersRow.includes('테이블'))
    check('07A 층 필터 칩', (await page.locator('[data-grant-chip="layer-ALL"]').count()) === 1)

    // ── 07C: 세트 저장 — 계정에서 뜨고, 모자람을 만들 INSERT 를 더한다 ─────────
    await click('[data-grant-set-new]')
    await page.waitForSelector('[data-grant-set-editor]', { timeout: 5_000 })
    await page.locator('[data-grant-set-name]').fill('E2E-읽기')
    await click('button:has-text("계정에서 뜨기")') // 현황을 시작점으로(sets AC-4)
    await page.waitForTimeout(200)
    const pattern0 = await page.locator('[data-grant-pattern="0"]').inputValue()
    check('07C 계정에서 뜨기 — 지금 권한이 패턴으로', pattern0 === 'testdb.users')
    // INSERT 체크(둘째 칸) — rky_grants 에겐 없어서 대조가 "모자람 1" 을 낸다
    await page.locator('[data-grant-set-editor] tbody tr').first().locator('input[type="checkbox"]').nth(1).check()
    await click('[data-grant-set-save]')
    await page.waitForSelector('[data-grant-set="E2E-읽기"]', { timeout: 5_000 })
    check('07C 세트 저장 — 목록에 뜬다', true)

    // ── 07D: 대조 — 모자람·양쪽 개수 ─────────────────────────────────────────
    await click('[data-grant-set="E2E-읽기"]')
    await page.waitForSelector('[data-grant-diff-summary]', { timeout: 5_000 })
    const summary = await page.locator('[data-grant-diff-summary]').innerText()
    check('07D 양쪽 개수 — 패턴·매칭·요구·확인', /세트 패턴 1 · 매칭 테이블 1 · 요구 2 · 확인 1/.test(summary))
    const missingChip = await page.locator('[data-grant-chip="diff-missing"]').innerText()
    check('07D 모자람이 갈라 보인다', missingChip.includes('1'))
    const rowInDiff = await page.locator('[data-grant-row="users"]').innerText()
    check('07D 모자람 배지가 셀에 붙는다', rowInDiff.includes('모자람'))

    // ── 07E: 적용 안전장치 — 미리보기 먼저 · REVOKE 기본 꺼짐 · 승인 전 무실행 ──
    await page.waitForSelector('[data-grant-apply-bar]', { timeout: 5_000 })
    check('07E REVOKE 토글 기본 꺼짐', !(await page.locator('[data-grant-revoke-toggle]').isChecked()))
    await click('[data-grant-sql-toggle]')
    await page.waitForTimeout(300)
    check('07E 문장 미리보기 — 실행될 GRANT 가 먼저 보인다', (await body()).includes('GRANT INSERT ON `testdb`.`users`'))
    // 적용은 누르지 않는다 — 새로고침 뒤에도 모자람이 그대로면 실행이 없었다는 뜻
    await click('button:has-text("새로고침")')
    await page.waitForSelector('[data-grant-diff-summary]', { timeout: 15_000 })
    check('07E 승인 전 무실행 — 재조회해도 모자람 유지', /요구 2 · 확인 1/.test(await page.locator('[data-grant-diff-summary]').innerText()))

    // ── 07B: 일반 계정 — 오류가 아니라 "못 본다" ─────────────────────────────
    await page.evaluate(async () => {
      const conn = (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql')
      if (conn) window.__rockuryNav.setContextValue('conn', conn.id)
    })
    await page.waitForTimeout(1500)
    const pageText = await body()
    check('07B "못 본다" 경고 줄', pageText.includes('현재 계정의 권한만 표시됩니다'))
    check('07B 자기 계정은 목록에 있다', (await page.locator('[data-grant-account]').count()) >= 1)
    check('07B "계정 없음" 으로 표시되지 않는다', !pageText.includes('계정 없음'))

    // ── SQLite: 본문 한 줄 (52 가 만든 샘플 DB 연결) ─────────────────────────
    const hasSqlite = await page.evaluate(async () => {
      const conn = (await window.rockury.connections.list()).find((c) => c.dbType === 'sqlite')
      if (conn) window.__rockuryNav.setContextValue('conn', conn.id)
      return !!conn
    })
    if (hasSqlite) {
      await page.waitForTimeout(600)
      check('SQLite — 권한 개념 없음 한 줄', (await body()).includes('SQLite — 권한 개념 없음'))
    }
  } finally {
    // 원복 — 픽스처 계정·세트. 실 DB 권한은 이 스위트가 아무것도 안 바꿨다.
    // root 연결 카드는 남긴다(E2E-mysql 과 같은 대접) — API 로 지우면 이 창의 스토어가
    // 몰라서 유령 카드가 남는다.
    await page.evaluate(async (id) => {
      await window.rockury.query.run(id, "DROP USER IF EXISTS 'rky_grants'@'%'").catch(() => {})
      for (const s of await window.rockury.grantSets.list())
        if (s.name === 'E2E-읽기') await window.rockury.grantSets.delete(s.id)
    }, rootId)
  }
}
