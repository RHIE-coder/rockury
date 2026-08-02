// 스모크 스위트 — 상단 두 줄 구조: 모듈 줄은 이동만 하고, 대상 고르기는 뷰 탭 줄이 든다.
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 2026-07-30 개편(상단 컨텍스트 바 제거 · Overview 제거)에 더해 2026-08-02 개편을 고정한다:
// 구획 손잡이가 모듈 줄에서 **뷰 탭 줄 오른쪽 끝**으로 내려가, 그 구획을 쓰는 화면에서만 뜬다.
// 되돌아가기 쉬운 것들이라 검사로 못박는다 —
//   ⑴ 구획 뱃지는 "구획이 시작하는 자리"마다 떠야 한다(전환 지점에만 그리면 첫 구획이 뱃지를 잃는다)
//   ⑵ 손잡이는 **자기 구획 화면에만** 뜬다 — 설계 화면에 연결이, 운영 화면에 설계가 떠 있으면 안 된다
//   ⑶ 단 Migration 은 설계와 실 DB 를 견주므로 **둘 다** 든다(`Module.handles`)
//   ⑷ 시점 손잡이는 설계부 전 화면에서 **하나만** 있어야 한다(두 곳이 말하면 숫자가 어긋난다)
//   ⑸ 좁은 창에서는 손잡이의 상태말이 접혀야 한다(안 접히면 뷰 탭이 밀려 나간다)
//   ⑹ 다른 서비스(api·uiux)는 예전 컨텍스트 바를 그대로 써야 한다

export const meta = {
  name: '50-db-nav-handles',
  needsDb: false,
  desc: 'DB 상단 두 줄 — 뷰 탭 줄의 구획 손잡이(설계+시점 · 연결+범위) · Overview 제거 · 축약 규칙'
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
  check('DB: 첫 착지가 설계부(Design)다', modules[0] === 'design')
  // 2026-07-30 — Connections 는 Remote 와 나란한 모듈이 아니라 Remote 의 첫 뷰로 들어갔다.
  check('DB: Connections 는 모듈 줄에 없다', !modules.includes('connections'))

  // ── 상단 두 줄 ────────────────────────────────────────────
  // L4 도구줄이 컨텍스트 바와 같은 h-11/bg-panel 을 쓰므로 클래스가 아니라 역할 훅으로 센다.
  check('DB: 컨텍스트 바가 없다', (await page.locator('[data-context-bar]').count()) === 0)
  const topText = await body()
  check('DB: 설계·운영 뱃지 라벨이 모듈 줄에 둘 다 보인다', topText.includes('설계') && topText.includes('운영'))

  // ⑵ 착지는 설계부(Design) — 설계 손잡이만 뜨고 운영 손잡이는 안 뜬다.
  check('DB › Design: 설계 손잡이가 뷰 탭 줄에 있다', (await page.locator('[data-area-handle="design"]').count()) === 1)
  check('DB › Design: 운영 손잡이는 없다 — 설계 화면에서 고를 대상이 아니다', (await page.locator('[data-area-handle="ops"]').count()) === 0)
  check('DB › Design: 설계 셀렉터가 그 손잡이 안에 있다', (await page.locator('[data-area-handle="design"] [data-context-selector="design"]').count()) === 1)
  check('DB › Design: 연결 셀렉터는 안 뜬다', (await page.locator('[data-context-selector="conn"]').count()) === 0)

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

    // ⑸ 축약 규칙 — 1600 미만에서 상태말이 접혀야 뷰 탭이 안 밀린다.
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

  // ── 운영부에서는 운영 손잡이로 바뀐다 ───────────────────────
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(500)
  check('DB › Remote: 운영 손잡이가 있다', (await page.locator('[data-area-handle="ops"]').count()) === 1)
  check('DB › Remote: 연결 셀렉터가 그 안에 있다', (await page.locator('[data-area-handle="ops"] [data-context-selector="conn"]').count()) === 1)
  check('DB › Remote: 설계 손잡이는 없다 — 운영 화면에서 고를 대상이 아니다', (await page.locator('[data-area-handle="design"]').count()) === 0)
  // Connections 는 Remote 의 **맨 왼쪽** 뷰다(사용자 결정) — 기억이 없는 첫 방문의 착지점.
  const consoleViews = await page.$$eval('[data-nav-view]', (els) =>
    els.map((e) => e.getAttribute('data-nav-view'))
  )
  check(`DB › Remote: 첫 뷰가 Connections (${consoleViews.join(',')})`, consoleViews[0] === 'connections')

  // 2026-07-30 사용자 피드백 — 모듈에 **다시** 들어오면 마지막에 보던 뷰로 돌아온다.
  // (그전에는 늘 첫 뷰로 되돌아가 "자꾸 connections 에 들어온다"는 제보가 왔다.)
  await click('[data-nav-view="data"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="versions"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(400)
  check(
    'DB › Remote: 다시 들어오면 마지막에 보던 뷰(Data)로 돌아온다',
    (await page.locator('[data-nav-view="data"][data-state="active"]').count()) === 1
  )
  // 모듈마다 **따로** 기억한다 — Remote 의 기억이 Migration 의 자리를 덮지 않는다.
  // (앞 스위트들이 이미 돌아다녔으므로 "첫 방문"에 기대지 않고 여기서 자리를 직접 만든다.)
  await click('[data-nav-module="migration"]')
  await page.waitForTimeout(300)
  // ⑶ 건너가는 자리는 설계와 실 DB 를 **견주는** 곳이라 둘 다 든다(`Module.handles`).
  //    구획(`common`) 기본값만 따르면 여기서 손잡이가 둘 다 사라져 아무것도 못 고른다.
  check('DB › Migration: 설계 손잡이가 있다', (await page.locator('[data-area-handle="design"]').count()) === 1)
  check('DB › Migration: 운영 손잡이도 있다', (await page.locator('[data-area-handle="ops"]').count()) === 1)
  await click('[data-nav-view="plan"]')
  await page.waitForTimeout(300)
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(300)
  check(
    'DB › Remote: Migration 을 다녀와도 Remote 의 기억은 그대로 Data',
    (await page.locator('[data-nav-view="data"][data-state="active"]').count()) === 1
  )
  await click('[data-nav-module="migration"]')
  await page.waitForTimeout(300)
  check(
    'DB › Migration: 자기 기억(Plan)으로 돌아온다',
    (await page.locator('[data-nav-view="plan"][data-state="active"]').count()) === 1
  )
  // ── 공통 모듈은 손잡이가 없다 ──────────────────────────────
  // Reference 는 어느 부서의 대상도 안 쓴다 — 뷰도 없으므로 뷰 탭 줄 자체가 안 그려져야 한다.
  await click('[data-nav-module="reference"]')
  await page.waitForTimeout(300)
  check('DB › Reference: 손잡이가 하나도 없다', (await page.locator('[data-area-handle]').count()) === 0)

  // 뒤 스위트가 기대하는 자리로 돌려놓는다 — 기억이 남으므로 명시적으로 되돌린다.
  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(300)
  await click('[data-nav-view="connections"]')
  await page.waitForTimeout(300)

  // ── ⑹ 다른 서비스는 예전 바 그대로 ─────────────────────────
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
