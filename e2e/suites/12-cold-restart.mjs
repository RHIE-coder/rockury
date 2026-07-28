// 스모크 스위트 — 콜드 재시작(프로세스 종료→재기동) 후 영속 — 연결·시드·편집 반영
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '12-cold-restart',
  needsDb: true,
  desc: '콜드 재시작(프로세스 종료→재기동) 후 영속 — 연결·시드·편집 반영'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // ⭐ 콜드 재시작(프로세스 종료→재기동, 같은 userData) 후 연결 잔존 — 진짜 영속 검증.
  //    (renderer reload 가 아니라 실제 앱을 껐다 켠다. 사용자가 겪은 시나리오.)
  page = await ctx.relaunch()
  await click('button:has-text("Connections")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  check('콜드 재시작 후 연결 잔존(SQLite 영속)', (await body()).includes('E2E-mysql'))

  // ⭐ CASE-console-04H — 다이어그램 배치·그룹도 콜드 재시작을 넘긴다.
  //    (07 에서 만든 `그룹 1`(users·user_roles)이 그대로 있어야 한다.)
  {
    const saved = await page.evaluate(async () => {
      const cid = (await window.rockury.connections.list())[0].id
      const l = await window.rockury.diagram.getLayout(cid)
      return {
        positions: l ? Object.keys(l.positions).length : 0,
        groups: (l?.groups ?? []).map((g) => ({ name: g.name, n: g.tableIds.length }))
      }
    })
    check('콜드 재시작 후 다이어그램 배치 잔존', saved.positions > 0)
    check(
      '콜드 재시작 후 다이어그램 그룹 잔존(이름·소속)',
      saved.groups.some((g) => g.name === '그룹 1' && g.n === 2)
    )
  }

  // 시드 세트도 콜드 재시작을 넘긴다 — CASE-studio-044(선언·행 잔존).
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await page.waitForTimeout(300)
  await click('button:has-text("Studio")')
  await click('button:has-text("Seed")')
  await page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
  const seedAfterRestart = await body()
  check('콜드 재시작 후 시드 세트·행 잔존',
    seedAfterRestart.includes('SEED-0001') && seedAfterRestart.includes('SEED-0002'))
  check('콜드 재시작 후 변수 셀 잔존', (await page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

  // 회귀: 재시작 직후(세트를 클릭하지 않은 상태)에도 편집이 먹어야 한다 — activeKey 가 비어 있어
  //   스토어가 대상 세트를 못 찾고 조용히 no-op 되던 문제.
  {
    const before = await page.locator('[data-seed-row]').count()
    await click('button:has-text("행 추가")')
    await page.waitForTimeout(300)
    check('재시작 직후 편집 반영(행 추가 no-op 회귀)', (await page.locator('[data-seed-row]').count()) === before + 1)
  }
}
