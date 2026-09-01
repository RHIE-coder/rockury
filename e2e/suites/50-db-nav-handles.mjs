// 스모크 스위트 — 상단 두 줄 구조: 모듈 줄은 이동만 하고, 대상 고르기는 뷰 탭 줄이 든다.
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.
//
// 2026-07-30 개편(상단 컨텍스트 바 제거 · Overview 제거)에 더해 2026-08-02 개편을 고정한다:
// 구획 손잡이가 모듈 줄에서 **뷰 탭 줄 오른쪽 끝**으로 내려가, 그 구획을 쓰는 화면에서만 뜬다.
// 되돌아가기 쉬운 것들이라 검사로 못박는다 —
//   ⑴ 구획 뱃지는 구획마다 하나씩, **다리(Migration 으로 이어지는 선) 쪽 끝**에 떠야 한다
//      (2026-08-03 사용자 요청 — 선을 눈으로 따라가면 그 끝에 부서 이름이 서 있어야 한다)
//   ⑵ 손잡이는 **자기 구획 화면에만** 뜬다 — 설계 화면에 연결이, 운영 화면에 설계가 떠 있으면 안 된다
//   ⑶ 단 Migration 은 설계와 실 DB 를 견주므로 **둘 다** 든다(`Module.handles`)
//   ⑷ 시점 손잡이는 설계부 전 화면에서 **하나만** 있어야 한다(두 곳이 말하면 숫자가 어긋난다)
//   ⑸ 좁은 창에서는 손잡이의 상태말이 접혀야 한다(안 접히면 뷰 탭이 밀려 나간다)
//   ⑹ 다른 서비스(api·uiux)는 예전 컨텍스트 바를 그대로 써야 한다
//   ⑺ 손잡이의 **모양**은 화면마다 다르다 — Migration 만 두 단 카드(좌우로 갈림)이고
//      Design·Remote 는 예전 한 줄(오른쪽 끝)이다(`Module.handleLayout` · 2026-08-04)
//   ⑻ 뷰 묶음 이름표 단은 **쓰는 화면에만** 선다 — 안 쓰는 화면의 탭 줄 높이는 그대로다
//   ⑼ Design › Query·Collection 은 Remote 와 **같은 화면**이다 — 접속이 필요한 동작만 잠긴다
//
// ⑺⑻⑼ 는 모두 2026-08-05 회귀다. 셋 다 원인이 하나다: **한 화면에 요청된 것을 공용 부품에
// 못박아 다른 화면까지 바뀌었다.** 유무만 보는 검사는 이런 번짐을 못 잡아서(세 화면 다 "있었다")
// 좌표·구성으로 잰다.

export const meta = {
  name: '50-db-nav-handles',
  needsDb: false,
  desc: 'DB 상단 두 줄 — 뷰 탭 줄의 구획 손잡이(설계+시점 · 연결+범위) · Overview 제거 · 축약 규칙'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  const page = ctx.page

  await click('[data-nav-service="db"]')
  await page.waitForTimeout(300)
  // 서비스만 누르면 **마지막에 보던 모듈**로 열린다(`nav/recall`) — 앞 스위트가 DB 를 Remote 에
  // 두고 나가므로 설계부 검사를 하려면 모듈까지 짚어야 한다(안 그러면 Remote 의 뷰 줄을 재게 된다).
  await click('[data-nav-module="design"]')
  await page.waitForTimeout(400)

  // ── 모듈 구성 ──────────────────────────────────────────────
  const modules = await page.$$eval('[data-nav-module]', (els) =>
    els.map((e) => e.getAttribute('data-nav-module'))
  )
  check(`DB: Overview 모듈이 없다 (${modules.join(',')})`, !modules.includes('overview'))
  // 2026-08-03 — 모듈 줄은 `Design ——Migration—— Remote` 셋뿐이다. Versions·Reference 는 Design 안 뷰로.
  check(`DB: 모듈 줄은 세 칸이다 (${modules.join(',')})`, modules.join(',') === 'design,migration,remote')
  check('DB: 첫 착지가 설계부(Design)다', modules[0] === 'design')
  // 2026-07-30 — Connections 는 Remote 와 나란한 모듈이 아니라 Remote 의 첫 뷰로 들어갔다.
  check('DB: Connections 는 모듈 줄에 없다', !modules.includes('connections'))
  const designViews = await page.$$eval('[data-nav-view]', (els) =>
    els.map((e) => e.getAttribute('data-nav-view'))
  )
  check(
    `DB › Design: Versions·Reference 가 이 줄 안에 있다 (${designViews.join(',')})`,
    designViews.includes('versions') && designViews.includes('reference')
  )

  // ── 상단 두 줄 ────────────────────────────────────────────
  // L4 도구줄이 컨텍스트 바와 같은 h-11/bg-panel 을 쓰므로 클래스가 아니라 역할 훅으로 센다.
  check('DB: 컨텍스트 바가 없다', (await page.locator('[data-context-bar]').count()) === 0)
  // 구획 이름표('설계'·'운영')는 2026-08-17 에 걷어냈다 — 소속은 카드 색이 말하고, 그 두 낱말이
  // 가운데 묶음을 넓혀 양옆 손잡이 자리를 빼앗고 있었다. 그래서 여기서도 낱말이 아니라 **카드**를 센다.
  check('DB: 구획 이름표는 없다 — 소속은 카드 색이 말한다', (await page.locator('[data-area-chip]').count()) === 0)

  // ⑴ 부서마다 카드 한 장이다(2026-08-04 사용자 요청).
  //    설계 카드 — Migration — 운영 카드 순서는 좌표로만 드러나므로 x 로 잰다.
  const midX = async (sel) => {
    const box = await page.locator(sel).first().boundingBox()
    return box ? box.x + box.width / 2 : null
  }
  check('DB: 설계 카드가 있다', (await page.locator('[data-area-card="design"]').count()) === 1)
  check('DB: 운영 카드가 있다', (await page.locator('[data-area-card="ops"]').count()) === 1)
  const [designCard, opsCard, gate] = await Promise.all([
    midX('[data-area-card="design"]'),
    midX('[data-area-card="ops"]'),
    midX('[data-nav-module="migration"]')
  ])
  check('DB: 건너가는 문이 두 카드 사이에 선다', designCard < gate && gate < opsCard)

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
  await click('[data-nav-view="versions"]')
  await page.waitForTimeout(400)
  check('DB › Design › Versions: 시점 손잡이가 여기도 하나 있다', (await page.locator('[data-version-lens]').count()) === 1)

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
  await click('[data-nav-module="design"]')
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
  // ── ⑺ 손잡이 **모양**은 화면마다 다르다 ─────────────────────
  // 회귀(2026-08-04): 손잡이는 컴포넌트 하나라, Migration 한 화면에 요청된 두 단 카드를
  // 컴포넌트에 못박았더니 Design·Remote 까지 같이 바뀌었다. 위의 유무 검사들은 그 번짐을
  // 하나도 못 잡았다 — 손잡이는 세 화면 모두 "있었기" 때문이다. 모양은 좌표로만 드러나므로
  // 접힘(높이)과 자리(x)로 잰다. 앞에서 설계를 이미 골라 두어 아랫단이 실제로 그려진다.
  const handleBox = async (area) => page.locator(`[data-area-handle="${area}"]`).first().boundingBox()
  const firstTabX = async () => (await page.locator('[data-nav-view]').first().boundingBox()).x

  // 2026-08-05 — 손잡이가 **모듈 줄 양끝**으로 올라갔다(`handleLayout: 'sides'`). 자리가 바뀐 것이
  // 좌표로만 드러나므로 y(어느 줄인가)와 x(줄의 어느 쪽인가)로 잰다. 모양은 이제 어디서나 한 줄이다.
  const migDesign = await handleBox('design')
  const migOps = await handleBox('ops')
  const moduleRow = await page.locator('[data-nav-module="migration"]').first().boundingBox()
  const viewRow = await page.locator('[data-nav-view="drift"]').first().boundingBox()
  check(
    `DB › Migration: 손잡이가 모듈 줄에 있다 (손잡이 y=${Math.round(migDesign.y)} · 모듈 y=${Math.round(moduleRow.y)} · 뷰 y=${Math.round(viewRow.y)})`,
    migDesign.y < viewRow.y && migOps.y < viewRow.y
  )
  check(`DB › Migration: 설계 손잡이가 줄 맨 왼쪽 (${Math.round(migDesign.x)} < ${Math.round(moduleRow.x)})`, migDesign.x < moduleRow.x)
  check(`DB › Migration: 운영 손잡이가 줄 맨 오른쪽 (${Math.round(migOps.x)} > ${Math.round(moduleRow.x)})`, migOps.x > moduleRow.x)
  // 검사 창은 1440 이라 손잡이 자리가 넉넉하다 — 그 폭에서는 **한 줄**이다.
  // 좁아지면 두 단으로 접히는 것이 정상이고(2026-08-17), 그 판정은 자리 폭(`@container/handle`)이 한다.
  check(`DB › Migration: 넓은 창에서는 한 줄이다 (h=${Math.round(migDesign.height)})`, migDesign.height < 44)
  check('DB › Migration: 뷰 탭 줄에는 손잡이가 없다', migDesign.y < viewRow.y && migOps.y < viewRow.y)

  await click('[data-nav-module="remote"]')
  await page.waitForTimeout(400)
  const remOps = await handleBox('ops')
  const remTab = await page.locator('[data-nav-view]').first().boundingBox()
  check(`DB › Remote: 손잡이도 모듈 줄에 있다 (${Math.round(remOps.y)} < 뷰 탭 ${Math.round(remTab.y)})`, remOps.y < remTab.y)
  check(`DB › Remote: 줄 오른쪽 끝 (${Math.round(remOps.x)} > 뷰 탭 ${Math.round(remTab.x)})`, remOps.x > remTab.x)

  await click('[data-nav-module="design"]')
  await page.waitForTimeout(400)
  const dsDesign = await handleBox('design')
  const dsTab = await page.locator('[data-nav-view]').first().boundingBox()
  check(`DB › Design: 손잡이도 모듈 줄에 있다 (${Math.round(dsDesign.y)} < 뷰 탭 ${Math.round(dsTab.y)})`, dsDesign.y < dsTab.y)
  // 설계는 왼쪽, 운영은 오른쪽 — 모듈 줄의 `Design ── Migration ── Remote` 와 같은 좌우 문법이다.
  check(`DB › Design: 줄 왼쪽 끝 (${Math.round(dsDesign.x)} < 운영 ${Math.round(remOps.x)})`, dsDesign.x < remOps.x)
  check(`DB: 넓은 창에서는 어느 화면에서나 한 줄 (h=${Math.round(dsDesign.height)})`, dsDesign.height < 44)

  // 카드 순서는 `Design ── Migration ── Remote` — 좌우 문법이 화면을 옮겨도 그대로다.
  const cx2 = async (sel) => {
    const b = await page.locator(sel).first().boundingBox()
    return b ? b.x + b.width / 2 : null
  }
  const [designCard2, gate2, opsCard2] = await Promise.all([
    cx2('[data-area-card="design"]'),
    cx2('[data-nav-module="migration"]'),
    cx2('[data-area-card="ops"]')
  ])
  check('DB: 설계 카드 → 문 → 운영 카드 순서다', designCard2 < gate2 && gate2 < opsCard2)

  // ── ⑼ Design › Query·Collection 은 Remote 와 **같은 화면**이다 ──
  // 회귀(2026-08-05): 라이브러리 소속을 설계로 옮기면서 설계부용으로 **줄인 화면을 따로 만들었다.**
  // 그래서 오른쪽 패널도 필터도 결과 영역도 없었다 — 시킨 것은 옮기는 일이었다. 지금은 한
  // 컴포넌트가 둘을 다 그리고, 갈리는 것은 접속이 필요한 동작(Run·EXPLAIN)과 거기서 파생된
  // 결과 영역뿐이다.
  await click('[data-nav-module="design"]')
  await page.waitForTimeout(300)
  await click('[data-nav-view="query"]')
  await page.waitForTimeout(600)
  check('DB › Design › Query: 왼쪽 트리 필터가 있다', (await page.locator('input[placeholder="Filter queries..."]').count()) === 1)
  check('DB › Design › Query: 오른쪽 Schema 패널이 있다', (await page.locator('input[placeholder="Filter..."]').count()) === 1)
  // 결과 영역은 **일부러 걷었다**(2026-09-01 제보 ②) — 설계부엔 실행이 없어 영원히 빈 칸이었다.
  // 위 두 줄(트리 필터·Schema 패널)이 "줄인 화면을 따로 만들지 않았다"는 원래 회귀를 계속 지킨다.
  check('DB › Design › Query: 결과 영역이 없다', !(await body()).includes('SQL 을 실행하면 결과가 여기 표시됩니다'))
  // 접속이 없으니 못 돌린다 — **여기만** 잠긴다.
  check('DB › Design › Query: Run 이 잠겨 있다', !(await page.locator('button:has-text("Run")').first().isEnabled()))
  check('DB › Design › Query: 왜 못 돌리는지 말한다', (await body()).includes('실행은 Remote 에서'))

  await click('[data-nav-view="collection"]')
  await page.waitForTimeout(600)
  check('DB › Design › Collection: 왼쪽 컬렉션 필터가 있다', (await page.locator('input[placeholder="Filter collections..."]').count()) === 1)
  check('DB › Design › Collection: 오른쪽 QUERIES 패널이 있다', (await page.locator('input[placeholder="Filter..."]').count()) === 1)

  // ── Reference 는 이제 Design 안 뷰다 ───────────────────────
  // 2026-08-03 이전엔 어느 부서도 아닌 모듈이라 손잡이가 하나도 없었다. Design 안으로 들어오면서
  // 설계 손잡이가 딸려 뜬다 — 손잡이는 모듈 단위라, 이건 자리를 옮긴 값이지 버그가 아니다.
  await click('[data-nav-module="design"]')
  await page.waitForTimeout(300)
  await click('[data-nav-view="reference"]')
  await page.waitForTimeout(300)
  check('DB › Design › Reference: 설계 손잡이를 Design 줄과 똑같이 쓴다', (await page.locator('[data-area-handle="design"]').count()) === 1)
  check('DB › Design › Reference: 운영 손잡이는 없다', (await page.locator('[data-area-handle="ops"]').count()) === 0)

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
