// 스모크 스위트 — Connections — 연결 생성·mysql 연결 테스트·그룹 DnD·자동확인
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '06-connections',
  needsDb: true,
  desc: 'Connections — 연결 생성·mysql 연결 테스트·그룹 DnD·자동확인'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // ── 운영부: Connection(1급) 생성 + mysql test-db 연결 테스트 (설계 불필요) ──
  await click('button:has-text("Connections")')
  await page.waitForTimeout(300)
  await click('button:has-text("새 연결")')
  await page.waitForSelector('text=연결 이름', { timeout: 5_000 })
  await page.locator('input[placeholder*="운영 DB"]').fill('E2E-mysql')
  await page.locator('input[placeholder="3306"]').fill('13306') // test-db mysql 포트 (기본 벤더 mysql)
  await page.locator('input[placeholder="testdb"]').fill('testdb')
  await page.locator('input[placeholder="test"]').fill('test')
  await page.locator('input[type="password"]').fill('test')
  await click('button:has-text("연결 테스트")')
  await page.waitForSelector('text=연결 성공', { timeout: 15_000 })
  check('Connections: mysql test-db 연결 성공(serverVersion)', (await body()).includes('연결 성공'))
  await click('button[type="submit"]:has-text("연결 만들기")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 5_000 })
  check('연결 카드(E2E-mysql) 생성', (await body()).includes('E2E-mysql'))

  // ── Connection 그룹: 생성(인라인 이름) → 카드 DnD 로 그룹 넣기/빼기 → 그룹 삭제 ──
  {
    await click('button:has-text("새 그룹")')
    await page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await page.locator('input[data-group-rename]').fill('E2E-그룹')
    await page.keyboard.press('Enter')
    await page.waitForSelector('text=E2E-그룹', { timeout: 5_000 })
    check('Connections: 그룹 생성 + 인라인 이름 변경(E2E-그룹)', (await body()).includes('E2E-그룹'))

    // 카드를 그룹 영역으로 드래그 → group_id 영속 (포인터 DnD: 고스트·플레이스홀더 경로)
    const dragCardTo = async (zoneSel) => {
      const cbox = await page.locator('[data-conn-id]').first().boundingBox()
      const zbox = await page.locator(zoneSel).first().boundingBox()
      await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + 12)
      await page.mouse.down()
      await page.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(500) // move IPC 영속 대기
    }
    await dragCardTo('section[data-conn-group]:not([data-conn-group=""])')
    const groupedId = await page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 → 그룹 소속 저장(groupId)', !!groupedId)

    // 그룹에서 미분류 영역으로 드래그 아웃 → group_id 해제
    await dragCardTo('section[data-conn-group=""]')
    const ungroupedId = await page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 아웃 → 미분류 복귀(groupId null)', ungroupedId === null)

    // 두 번째 그룹을 만들고 그립 핸들 드래그로 순서 뒤집기 → 영속
    await click('button:has-text("새 그룹")')
    await page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await page.locator('input[data-group-rename]').fill('E2E-그룹2')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const orderBefore = await page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    // 두 번째 그룹 핸들을 첫 그룹 위로 끌어올린다
    {
      const handles = page.locator('button[data-group-handle]')
      const h2 = await handles.nth(1).boundingBox()
      const s1 = await page.locator('section[data-conn-group]:not([data-conn-group=""])').first().boundingBox()
      await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2)
      await page.mouse.down()
      await page.mouse.move(s1.x + s1.width / 2, s1.y + 4, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(500)
    }
    const orderAfter = await page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    check(
      'Connections: 그룹 핸들 드래그로 순서 변경(영속·역순)',
      orderBefore.length === 2 && orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]
    )
    // 만든 두 번째 그룹 정리
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await page.waitForTimeout(400)

    // 그룹 삭제(연결은 남아야 함)
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await page.waitForTimeout(400)
    const afterDelete = await page.evaluate(async () => ({
      groups: (await window.rockury.connectionGroups.list()).length,
      conns: (await window.rockury.connections.list()).length
    }))
    check('Connections: 그룹 삭제 → 그룹 0 개, 연결은 보존', afterDelete.groups === 0 && afterDelete.conns === 1)
  }

  // ── 자동확인 제외: 제외로 바꾸면 잔존 상태가 '미확인'으로 돌아오고, 새로고침이 다시 확인하지 않는다 ──
  //   (회귀: 제외 후에도 옛 '실패/연결됨'이 남아 "계속 확인되는 것처럼" 보이던 문제)
  {
    await click('button[title="편집"]')
    await page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await page.waitForSelector('text=자동확인 제외', { timeout: 5_000 })
    check('Connections: 자동확인 제외 배지 표시', (await body()).includes('자동확인 제외'))
    await click('button:has-text("새로고침")')
    await page.waitForTimeout(800)
    check('Connections: 제외 연결은 새로고침 후 미확인(재확인 안 함)', (await body()).includes('미확인'))
    // 원복 — 이후 흐름은 자동확인 대상 상태를 전제
    await click('button[title="편집"]')
    await page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await page.waitForTimeout(300)
  }

  // 카드 클릭 → active Connection → Console › Object 로 실 DB 역설계(Phase 2a)
  await click('div[role="button"]:has-text("E2E-mysql")')
  await page.waitForTimeout(200)
  await click('button:has-text("Console")')
  await click('button:has-text("Object")')
  await page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const obj = await body()
  check('Console › Object: 실 DB 역설계(users/user_roles)', obj.includes('users') && obj.includes('user_roles'))

}
