// 스모크 스위트 — 상단 한 줄 구조: 구획 뱃지가 자기 구획의 대상을 든다.
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 2026-07-30 개편을 고정한다: 상단 컨텍스트 바를 없애고 '설계' 뱃지가 설계+시점을,
// '운영' 뱃지가 연결을 들게 했다. Overview 모듈은 제거(Reference 는 유지).
// 되돌아가기 쉬운 것들이라 검사로 못박는다 —
//   ⑴ 뱃지는 "구획이 시작하는 자리"마다 떠야 한다(전환 지점에만 그리면 첫 구획이 뱃지를 잃는다)
//   ⑵ 시점 손잡이는 설계부 전 화면에서 **하나만** 있어야 한다(두 곳이 말하면 숫자가 어긋난다)
//   ⑶ 좁은 창에서는 손잡이의 상태말이 접혀야 한다(안 접히면 모듈 탭이 밀려 나간다)
//   ⑷ 다른 서비스(api·uiux)는 예전 컨텍스트 바를 그대로 써야 한다

export const meta = {
  name: '50-db-nav-handles',
  needsDb: false,
  desc: 'DB 상단 한 줄 — 구획 뱃지 손잡이(설계+시점 · 연결) · Overview 제거 · 축약 규칙'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  await click('[data-nav-service="db"]')
  await page.waitForTimeout(400)

  // ── 모듈 구성 ──────────────────────────────────────────────
  const modules = await page.$$eval('[data-nav-module]', (els) =>
    els.map((e) => e.getAttribute('data-nav-module'))
  )
  check(`DB: Overview 모듈이 없다 (${modules.join(',')})`, !modules.includes('overview'))
  check('DB: Reference 는 남아 있다', modules.includes('reference'))
  check('DB: 첫 착지가 설계부(Studio)다', modules[0] === 'studio')

  // ── 상단 한 줄 ────────────────────────────────────────────
  // L4 도구줄이 컨텍스트 바와 같은 h-11/bg-panel 을 쓰므로 클래스가 아니라 역할 훅으로 센다.
  check('DB: 컨텍스트 바가 없다', (await page.locator('[data-context-bar]').count()) === 0)
  check('DB: 설계 셀렉터가 모듈 줄에 있다', (await page.locator('[data-context-selector="design"]').count()) === 1)
  check('DB: 연결 셀렉터가 모듈 줄에 있다', (await page.locator('[data-context-selector="conn"]').count()) === 1)
  const topText = await body()
  check('DB: 설계·운영 뱃지 라벨이 둘 다 보인다', topText.includes('설계') && topText.includes('운영'))

  // ── 설계를 고르면 시점 손잡이가 딸려 나온다 ──────────────────
  if ((await page.locator('[data-version-lens]').count()) === 0) {
    await click('[data-context-selector="design"]')
    await page.waitForTimeout(250)
    await click('[role="menuitem"]:has-text("commerce-core")')
    await page.waitForTimeout(500)
  }
  check('DB: 설계를 고르면 시점 손잡이가 뜬다', (await page.locator('[data-version-lens]').count()) === 1)
  // 이름을 문자열로 박지 않는다 — 앞 스위트들이 설계를 여럿 만들고 활성 설계를 바꾼다.
  // 손잡이가 "고른 것을 말하고 있는가"(= placeholder 가 아닌가)만 본다.
  const designFace = await page.locator('[data-context-selector="design"]').first().innerText()
  check(`DB: 손잡이가 고른 설계를 말한다 (${designFace.trim()})`, !designFace.includes('설계 선택'))

  // ── 설계부 어느 화면에서나 같은 자리 ────────────────────────
  await click('[data-nav-module="versions"]')
  await page.waitForTimeout(400)
  check('DB › Versions: 시점 손잡이가 여기도 하나 있다', (await page.locator('[data-version-lens]').count()) === 1)

  // ── 시점 전환 + 읽기 전용 ──────────────────────────────────
  await click('[data-version-lens]')
  await page.waitForTimeout(250)
  const opts = await page.$$eval('[data-version-lens-option]', (els) =>
    els.map((e) => e.getAttribute('data-version-lens-option'))
  )
  check(`DB: 시점 목록은 Draft 가 맨 위 (${opts.join(',')})`, opts[0] === 'draft')
  const committed = opts.find((o) => o !== 'draft')
  if (committed) {
    await click(`[data-version-lens-option="${committed}"]`)
    await page.waitForTimeout(400)
    const lens = page.locator('[data-version-lens]').first()
    check(`DB: 커밋 버전(${committed})으로 바뀐다`, (await lens.innerText()).includes(committed))
    // 좁은 창에서는 상태말이 접히므로 **title** 로 확인한다 — 접힘 자체는 아래에서 따로 검사.
    check('DB: 커밋 버전은 읽기 전용이라고 말한다', (await lens.getAttribute('title'))?.includes('읽기 전용') === true)

    // ⑶ 축약 규칙 — 1600 미만에서 상태말이 접혀야 모듈 탭이 안 밀린다.
    const w = await page.evaluate(() => window.innerWidth)
    if (w < 1600) {
      check(`DB: 좁은 창(${w}px)에서는 손잡이 상태말이 접힌다`, !(await lens.innerText()).includes('읽기 전용'))
    } else {
      check(`DB: 넓은 창(${w}px)에서는 상태말이 그대로 보인다`, (await lens.innerText()).includes('읽기 전용'))
    }

    // 뒤 스위트가 Draft 를 전제하므로 되돌려 놓는다.
    await click('[data-version-lens]')
    await page.waitForTimeout(200)
    await click('[data-version-lens-option="draft"]')
    await page.waitForTimeout(300)
    check('DB: Draft 로 돌아온다', (await page.locator('[data-version-lens]').first().innerText()).includes('Draft'))
  } else {
    await page.keyboard.press('Escape')
    check('DB: 컷된 버전이 없어 읽기 전용 확인 생략', true)
  }

  // ── 운영부에서도 자리는 그대로 ─────────────────────────────
  await click('[data-nav-module="console"]')
  await page.waitForTimeout(500)
  check('DB › Console: 연결 셀렉터가 있다', (await page.locator('[data-context-selector="conn"]').count()) === 1)
  check('DB › Console: 설계 뱃지도 자리를 지킨다', (await page.locator('[data-context-selector="design"]').count()) === 1)

  // ── ⑷ 다른 서비스는 예전 바 그대로 ─────────────────────────
  await click('[data-nav-service="api"]')
  await page.waitForTimeout(500)
  check('api: 컨텍스트 바를 그대로 쓴다', (await page.locator('[data-context-bar]').count()) === 1)
  await click('[data-nav-service="uiux"]')
  await page.waitForTimeout(500)
  check('uiux: 컨텍스트 바를 그대로 쓴다', (await page.locator('[data-context-bar]').count()) === 1)

  // 뒤 스위트를 위해 DB 로 돌려놓는다.
  await click('[data-nav-service="db"]')
  await page.waitForTimeout(300)
}
