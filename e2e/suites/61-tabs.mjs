// 스모크 스위트 — 탭 줄과 여러 창(셸 공용) — 자리를 여러 장 열고, 끌어 옮기고, 창으로 떼어내고,
// 껐다 켜면 그대로 돌아온다.
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '61-tabs',
  needsDb: false,
  desc: '탭 줄 — 여러 장 열고 끌어 옮기고 창으로 떼어내고, 껐다 켜도 그대로'
}

export async function run(ctx) {
  const { check, body } = ctx
  let page = ctx.page
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=Design', { timeout: 15_000 })

  const tabs = () => page.locator('[data-nav-tab]')
  const activeTab = () => page.locator('[data-nav-tab-active]')
  const titles = () => tabs().allInnerTexts()

  // ── 처음엔 한 장, 닫기는 없다 ──
  // 마지막 한 장은 ⌘W 로 창째 닫는다 — 눌러도 아무 일 없는 단추를 두면 고장으로 읽힌다.
  check('탭 줄이 한 장으로 시작한다', (await tabs().count()) === 1)
  check(
    '한 장뿐이면 닫기 단추가 없다',
    (await tabs().first().locator('button[aria-label="탭 닫기"]').count()) === 0
  )
  const firstTitle = (await tabs().first().innerText()).trim()
  check('탭에 지금 보는 자리가 적힌다', firstTitle.length > 0)

  // ── `+` 는 지금 자리를 한 장 더 연다 → 새 탭이 활성 ──
  await page.locator('[data-tab-action="new-tab"]').click()
  await page.waitForTimeout(250)
  check('탭이 두 장이 됐다', (await tabs().count()) === 2)
  check('새로 연 탭으로 옮겨 간다', (await tabs().nth(1).getAttribute('data-nav-tab-active')) !== null)
  check(
    '두 장이 되면 닫기 단추가 생긴다',
    (await tabs().first().locator('button[aria-label="탭 닫기"]').count()) === 1
  )

  // ── 화면 이동은 **활성 탭에만** 걸린다 ──
  // 이게 안 지켜지면 탭이 전부 같은 곳을 가리켜, 여러 장 여는 뜻이 없어진다.
  await page.locator('[data-nav-service="api"]').click()
  await page.waitForTimeout(400)
  const apiTitle = (await activeTab().innerText()).trim()
  check('활성 탭이 옮겨 간 자리를 가리킨다', apiTitle !== firstTitle)
  check('안 켜진 탭은 그대로 있다', (await tabs().first().innerText()).trim() === firstTitle)

  // ── 탭을 누르면 그 자리로 돌아온다 ──
  await tabs().first().click()
  await page.waitForTimeout(400)
  check('첫 탭으로 돌아오면 그 자리가 다시 켜진다', (await activeTab().innerText()).trim() === firstTitle)
  check('레일의 켜진 서비스도 함께 돌아온다', (await body()).includes('Design'))

  // ── 끌어서 자리 옮기기 ──
  // 끌기는 브라우저 기본 끌기가 아니라 **마우스를 직접 듣는 방식**이다(TabBar 머리말) —
  // 그래서 검사도 실제 마우스로 누르고 옮기고 놓는다.
  const dragTab = async (from, to, dy = 0) => {
    const a = await tabs().nth(from).boundingBox()
    const b = await tabs().nth(to).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 4, b.y + b.height / 2 + dy, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }

  const before = (await titles()).map((t) => t.trim())
  await dragTab(1, 0)
  const after = (await titles()).map((t) => t.trim())
  check('끌어서 옮기면 순서가 뒤집힌다', after[0] === before[1] && after[1] === before[0])
  check('자리를 옮겨도 보던 탭은 그대로다', (await activeTab().innerText()).trim() === firstTitle)

  // ── 단축키(앱 메뉴가 쥔다) ──
  // 키를 화면에서 들으면 macOS 기본 메뉴의 ⌘W 가 먼저 먹어 탭 대신 창이 닫힌다 — 그래서 메뉴다.
  //
  // ⚠ 여기선 **메뉴 항목을 직접 누른다.** 검사가 만든 키 입력(`keyboard.press`)은 화면까지만 가고
  //   운영체제 메뉴의 단축키에는 안 닿는다(실측). 그래서 키 조합 자체는 손으로 확인할 몫이고,
  //   이 검사는 그 뒤 전부 — 메뉴 → 화면 → 탭이 움직이는 길 — 를 지킨다.
  const menu = async (label) => {
    await ctx.app.evaluate(({ Menu }, wanted) => {
      const items = Menu.getApplicationMenu().items.flatMap((i) => i.submenu?.items ?? [])
      items.find((i) => i.label === wanted)?.click()
    }, label)
    await page.waitForTimeout(350)
  }

  await menu('새 탭')
  check('메뉴 "새 탭"(⌘T)으로 탭이 하나 더 열린다', (await tabs().count()) === 3)

  await menu('1번째 탭')
  check('"1번째 탭"(⌘1)으로 첫 탭으로 간다', (await tabs().nth(0).getAttribute('data-nav-tab-active')) !== null)

  await menu('마지막 탭')
  check('"마지막 탭"(⌘9)은 끝으로 간다', (await tabs().nth(2).getAttribute('data-nav-tab-active')) !== null)

  await menu('다음 탭')
  check('"다음 탭"은 끝에서 처음으로 감는다', (await tabs().nth(0).getAttribute('data-nav-tab-active')) !== null)

  await menu('탭 닫기')
  check('메뉴 "탭 닫기"(⌘W)로 탭이 닫힌다', (await tabs().count()) === 2)

  // 키 조합 자체가 붙어 있는지는 메뉴에게 물어 지킨다 — 항목만 남고 단축키가 빠지면
  // 화면으로는 멀쩡해 보이는데 손은 안 먹는다.
  const accel = await ctx.app.evaluate(({ Menu }) =>
    Object.fromEntries(
      Menu.getApplicationMenu()
        .items.flatMap((i) => i.submenu?.items ?? [])
        .filter((i) => i.accelerator)
        .map((i) => [i.label, i.accelerator])
    )
  )
  check(
    '탭 단축키가 붙어 있다 (⌘T·⌘N·⌘W·⌘1·⌘9)',
    accel['새 탭'] === 'CmdOrCtrl+T' &&
      accel['새 창'] === 'CmdOrCtrl+N' &&
      accel['탭 닫기'] === 'CmdOrCtrl+W' &&
      accel['1번째 탭'] === 'CmdOrCtrl+1' &&
      accel['마지막 탭'] === 'CmdOrCtrl+9'
  )
  check(
    '표준 단축키를 안 잃었다 (복사·붙여넣기·전체선택·종료)',
    // 메뉴를 직접 세우면서 role 을 빼먹으면 입력칸에서 ⌘C 가 죽는다 — 실제로 쉬운 실수다.
    Boolean(accel['Copy'] && accel['Paste'] && accel['Select All'] && accel['Quit Rockury'])
  )

  // ── 탭을 줄 밖으로 빼내면 그 자리에서 창이 된다 ──
  // 예전엔 "손을 놓은 자리가 창 밖인가"로 갈랐다 — 창을 꽉 채워 놓으면 창 밖이 없어 영영 안 됐다.
  // 이제는 **탭 줄을 벗어났나**로 가르므로, 손을 놓기 전에 이미 창이 서 있어야 한다.
  const detachTitle = (await tabs().nth(1).innerText()).trim()
  const grab = await tabs().nth(1).boundingBox()
  const grabX = grab.x + grab.width / 2
  const grabY = grab.y + grab.height / 2
  const detached = ctx.app.waitForEvent('window')
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(grabX, grabY + 200, { steps: 8 })
  const dragWin = await detached
  await dragWin.waitForSelector('[data-nav-tab]', { timeout: 15_000 })
  check('줄 밖으로 빼내면 손을 놓기 전에 이미 창이 된다', (await tabs().count()) === 1)
  check(
    '빠져나간 탭이 새 창에 그대로 있다',
    (await dragWin.locator('[data-nav-tab]').first().innerText()).trim() === detachTitle
  )

  // ── 그 창을 탭 줄 위에서 놓으면 도로 흡수된다 ──
  // 마우스는 아직 눌린 채다 — 손을 놓기까지가 한 사건이라 원래 창이 계속 쥐고 있다.
  await page.mouse.move(grabX, grabY, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  check('탭 줄 위에 놓으면 그 창이 도로 삼킨다', (await tabs().count()) === 2)
  check(
    '도로 삼킨 탭이 그 자리 그대로다',
    (await titles()).map((t) => t.trim()).includes(detachTitle)
  )
  check('삼켰으면 끌려 나왔던 창은 사라진다', dragWin.isClosed())

  // 줄 바로 아래(여유 폭 안)까지는 안 뗀다 — 손이 떨릴 때마다 창이 생기면 못 쓴다.
  const beforeJitter = ctx.app.windows().length
  await dragTab(1, 0, 40)
  check('줄 여유 폭 안에서 움직이면 창이 안 생긴다', ctx.app.windows().length === beforeJitter)
  check('그때 탭도 그대로 두 장이다', (await tabs().count()) === 2)

  // ── 새 창: 지금 자리를 그대로 든 창이 하나 더 뜬다 ──
  const openedCount = ctx.app.windows().length
  const opened = ctx.app.waitForEvent('window')
  await page.locator('[data-tab-action="new-window"]').click()
  const win2 = await opened
  await win2.waitForSelector('[data-nav-tab]', { timeout: 15_000 })
  check('창이 하나 더 떴다', ctx.app.windows().length === openedCount + 1)
  check('떼어낸 창도 탭 한 장으로 시작한다', (await win2.locator('[data-nav-tab]').count()) === 1)
  check(
    '떼어낸 창은 지금 보던 자리로 열린다',
    (await win2.locator('[data-nav-tab]').first().innerText()).trim() ===
      (await activeTab().innerText()).trim()
  )

  // ── 떼어낸 창은 첫 창의 대상 선택을 덮지 않는다 ──
  // 두 창이 같은 브라우저 저장소를 쓰기 때문에 이걸 안 막으면 "마지막에 움직인 창"이 이겨서,
  // 앱을 껐다 켰을 때 어느 설계·범위로 돌아올지가 운에 달린다.
  const savedBefore = await page.evaluate(() => localStorage.getItem('rockury.nav'))
  await win2.locator('[data-nav-service="infra"]').click()
  await win2.waitForTimeout(500)
  const savedAfter = await page.evaluate(() => localStorage.getItem('rockury.nav'))
  check('떼어낸 창이 움직여도 첫 창의 저장본은 그대로다', savedBefore === savedAfter)

  await win2.close()
  await page.waitForTimeout(300)
  check('떼어낸 창을 닫아도 첫 창은 살아 있다', (await tabs().count()) === 2)

  // ── 한 장뿐인 창은 **창째** 끌린다 ──
  // 뗄 것이 없으니 남길 창이 곧 끌 창이다(브라우저와 같다).
  //
  // ⚠ 이 검사는 마우스를 **한 걸음씩** 옮긴다. 창이 움직이면 크로미움이 진짜 OS 커서를 기준으로
  //   마우스 이동을 다시 쏘는데, 검사 도구가 찍는 커서는 가상이라 그 둘이 어긋난다 — 창이 한 번
  //   움직인 뒤로는 검사가 커서를 못 쥔다(실제 사용에는 커서가 하나뿐이라 없는 일이다).
  //   그래서 "창이 따라오나"와 "줄에 놓으면 합쳐지나"를 **창을 따로 써서** 하나씩 본다.
  const openSolo = async () => {
    const coming = ctx.app.waitForEvent('window')
    await page.locator('[data-tab-action="new-window"]').click()
    const win = await coming
    await win.waitForSelector('[data-nav-tab]', { timeout: 15_000 })
    const handle = await ctx.app.browserWindow(win)
    // 작게 잡아 둔다 — 화면을 거의 채운 창은 작업영역 경계에 걸려 얼마나 움직였는지를 못 잰다.
    await handle.evaluate((w, b) => w.setContentBounds(b), {
      x: work.x + 40,
      y: work.y + 40,
      width: 900,
      height: 600
    })
    await win.waitForTimeout(400)
    const tab = await win.locator('[data-nav-tab]').first().boundingBox()
    return { win, handle, grab: { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 } }
  }
  const work = await ctx.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)

  // ⑴ 빼내면 창이 손을 따라온다
  const a = await openSolo()
  const aBefore = await a.handle.evaluate((w) => w.getContentBounds())
  await a.win.mouse.move(a.grab.x, a.grab.y)
  await a.win.mouse.down()
  // 첫 걸음은 창을 끌기 대상으로 세우기만 한다. 옮기는 것은 그 다음 걸음부터다.
  await a.win.mouse.move(a.grab.x, a.grab.y + 200)
  await a.win.waitForTimeout(350)
  await a.win.mouse.move(a.grab.x + 120, a.grab.y + 260)
  await a.win.waitForTimeout(350)
  const aAfter = await a.handle.evaluate((w) => w.getContentBounds())
  check('한 장뿐인 창은 탭을 빼내면 창째 따라온다', aAfter.x !== aBefore.x || aAfter.y !== aBefore.y)
  await a.win.mouse.up()
  await a.win.waitForTimeout(300)
  check('탭 줄이 아닌 데 놓으면 그대로 창으로 남는다', !a.win.isClosed())
  await a.win.close()
  await page.waitForTimeout(300)

  // ⑵ 다른 창의 탭 줄에 놓으면 그 창이 삼키고 빈 창은 사라진다
  const homeHandle = await ctx.app.browserWindow(page)
  const homeAt = await homeHandle.evaluate((w) => w.getContentBounds())
  const lastTab = await tabs().last().boundingBox()
  // 받을 자리 — 첫 창 탭 줄의 오른쪽 빈 곳(화면 좌표).
  const dropOn = {
    x: homeAt.x + lastTab.x + lastTab.width + 30,
    y: homeAt.y + lastTab.y + lastTab.height / 2
  }

  const b = await openSolo()
  const bAt = await b.handle.evaluate((w) => w.getContentBounds())
  const soloTitle = (await b.win.locator('[data-nav-tab]').first().innerText()).trim()
  await b.win.mouse.move(b.grab.x, b.grab.y)
  await b.win.mouse.down()
  await b.win.mouse.move(b.grab.x, b.grab.y + 200)
  await b.win.waitForTimeout(350)
  // 창은 아직 제자리다 — 받을 자리를 이 창 안 좌표로 바꿔 한 번에 겨눈다.
  await b.win.mouse.move(dropOn.x - bAt.x, dropOn.y - bAt.y)
  await b.win.waitForTimeout(350)
  check(
    '상대 줄에 얹히면 끌려온 창이 비쳐 보인다',
    (await b.handle.evaluate((w) => w.getOpacity())) < 1
  )
  await b.win.mouse.up()
  await page.waitForTimeout(700)

  check('한 장짜리 창을 탭 줄에 놓으면 그 창이 삼킨다', (await tabs().count()) === 3)
  check('합쳐진 탭이 맨 뒤에 선다', (await titles()).map((t) => t.trim())[2] === soloTitle)
  check('합쳐졌으면 빈 창은 사라진다', b.win.isClosed())

  // 뒤 검사(콜드 재시작)는 이 창의 탭을 그대로 비교한다 — 늘린 한 장을 도로 접는다.
  await page.locator('[data-nav-tab]').nth(2).locator('button[aria-label="탭 닫기"]').click()
  await page.waitForTimeout(300)
  check('정리 후 두 장으로 돌아왔다', (await tabs().count()) === 2)

  // ── 껐다 켜면 탭이 그대로 돌아온다 ──
  // 탭 묶음의 주인은 메인 프로세스다(브라우저 저장소가 아니다) — 이 검사가 그 사실을 지킨다.
  const beforeQuit = (await titles()).map((t) => t.trim())
  page = await ctx.relaunch()
  await page.waitForSelector('[data-nav-tab]', { timeout: 15_000 })
  await page.waitForTimeout(600)
  const restored = (await page.locator('[data-nav-tab]').allInnerTexts()).map((t) => t.trim())
  check('콜드 재시작 후 탭 수가 같다', restored.length === beforeQuit.length)
  check('콜드 재시작 후 탭 순서·이름이 같다', restored.join('|') === beforeQuit.join('|'))

  // 뒤 스위트는 탭 한 장을 전제하지 않지만, 남겨 두면 화면이 좁아지므로 정리한다.
  while ((await page.locator('[data-nav-tab]').count()) > 1) {
    await page.locator('[data-nav-tab] button[aria-label="탭 닫기"]').first().click()
    await page.waitForTimeout(200)
  }
  check('정리 후 한 장으로 돌아왔다', (await page.locator('[data-nav-tab]').count()) === 1)
}
