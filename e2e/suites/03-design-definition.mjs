// 스모크 스위트 — Design › Definition(제약 탭·뷰 선언) + Design › Diagram(가상 ERD 편집·라벨)
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '03-design-definition',
  needsDb: false,
  desc: 'Design › Definition(제약 탭·뷰 선언) + Design › Diagram(가상 ERD 편집·라벨)'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Design › Definition — 시드 테이블
  await click('button:has-text("Design")')
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=orders', { timeout: 5_000 })
  check('Definition: 시드 테이블(orders) 표시', (await body()).includes('orders'))

  /*
   * ── 컬럼 표의 두 규율 (2026-08-12 화면 피드백) ──
   *  ⑴ PK 컬럼의 NULL 칸은 잠긴다 — PK 는 곧 NOT NULL 이라 켤 수 있으면 실 DB 에 없는 모습이 된다
   *     ("PK인데 null이 가능해?").
   *  ⑵ 잘린 칸을 펴는 손잡이는 **칸 자신**이 든다 — 표 머리의 "전문 보기" 체크박스는 걷어냈다
   *     ("체크박스말고 좀 더 우아한 방법 없어?"). 손잡이는 넘치는 칸에만 붙는다.
   */
  {
    const nullBoxes = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button[aria-label="nullable"]')]
      return { total: all.length, locked: all.filter((b) => b.disabled).length }
    })
    check(
      `Design › Definition: PK 컬럼의 NULL 칸이 잠긴다 (잠김 ${nullBoxes.locked}/${nullBoxes.total})`,
      nullBoxes.total > 0 && nullBoxes.locked > 0
    )
    check('Design › Definition: 표 머리에 "전문 보기" 체크박스가 없다', !(await body()).includes('전문 보기'))

    // 손잡이가 **가려지지 않는가** — 가려진 손잡이는 없는 손잡이다(행 ⋯ 메뉴에 깔린 적이 있다).
    const reach = await page.evaluate(() =>
      [...document.querySelectorAll('[data-clip-toggle]')].map((b) => {
        const r = b.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return hit === b || b.contains(hit)
      })
    )
    check(
      `Design › Definition: 잘린 칸의 펼침 손잡이가 안 가려진다 (${reach.length}개)`,
      reach.length === 0 || reach.every(Boolean)
    )

    // 눌러서 실제로 펴지는가 — 그 줄만 높아진다(표 전체가 아니라).
    if (reach.length > 0) {
      const rowH = () =>
        page.evaluate(() => {
          const b = document.querySelector('[data-clip-toggle]')
          return b ? Math.round(b.closest('[style*="grid-template-columns"]').getBoundingClientRect().height) : 0
        })
      const before = await rowH()
      await page.locator('[data-clip-toggle]').first().click()
      await page.waitForTimeout(300)
      const after = await rowH()
      check(`Design › Definition: ⌄ 를 누르면 그 줄이 펴진다 (${before}→${after})`, after > before)
      await page.locator('[data-clip-toggle]').first().click()
      await page.waitForTimeout(200)

      /*
       * 회귀 — 2026-08-13 사용자: "편집 이후에 다시 나오면 또 이러는데?"
       *
       * 손잡이가 붙은 칸을 눌러 편집을 열면 그 칸이 입력 상자로 바뀌며 DOM 에서 빠진다.
       * 빠지는 순간 ResizeObserver 가 "크기 0" 으로 울리는데, 그 0 을 "안 넘침"으로 받아 적어
       * 손잡이가 사라졌고 편집을 닫아도 다시 잴 계기가 없어 **영영 안 돌아왔다**.
       */
      const cellWithToggle = () =>
        page.evaluate(() => {
          const b = document.querySelector('[data-clip-toggle]')
          return b?.parentElement?.querySelector('button:not([data-clip-toggle])') ? 1 : 0
        })
      const toggleCount = () => page.locator('[data-clip-toggle]').count()
      const wasCount = await toggleCount()
      if (wasCount > 0 && (await cellWithToggle())) {
        // 그 칸을 눌러 편집을 열고(입력 상자로 바뀐다) → Esc 로 값 그대로 닫는다.
        await page.evaluate(() =>
          document
            .querySelector('[data-clip-toggle]')
            ?.parentElement?.querySelector('button:not([data-clip-toggle])')
            ?.click()
        )
        await page.waitForTimeout(300)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
        const nowCount = await toggleCount()
        check(
          `Design › Definition: 편집을 여닫아도 펼침 손잡이가 남는다 (${wasCount}→${nowCount})`,
          nowCount === wasCount
        )
      }
    }
  }

  // ── Design › Definition — 사이드 패널 제약 탭(Remote 와 같은 구성) ──
  {
    await click('[data-side-tab="constraints"]')
    await page.waitForSelector('[data-constraint-group]', { timeout: 5_000 })
    check('Design › Definition: 제약 탭에 테이블별 그룹', (await page.locator('[data-constraint-group]').count()) > 0)
    check('Design › Definition: 제약 행 표시(pk_orders)', (await page.locator('[data-constraint-row="pk_orders"]').count()) === 1)
    // 종류 필터 — FK 만 남기면 pk 행이 사라진다
    await click('[data-constraint-filter="fk"]')
    await page.waitForTimeout(200)
    check('Design › Definition: 제약 종류 필터(FK)', (await page.locator('[data-constraint-row="pk_orders"]').count()) === 0)
    await click('[data-constraint-filter="ALL"]')
    await page.waitForTimeout(150)
    // 제약을 누르면 그 제약이 걸린 테이블로 이동한다
    await click('[data-constraint-row="pk_orders"]')
    await page.waitForTimeout(250)
    await click('[data-side-tab="tables"]')
    await page.waitForTimeout(200)
    check('Design › Definition: 제약 클릭 → 그 테이블로 이동', (await body()).includes('orders'))
  }

  /*
   * ── "이 테이블을 참조하는 곳" — **들어오는** FK(남 → 나). 2026-08-19 사용자 요청 ──
   * 화면은 여태 나가는 참조(나 → 남)만 보였다. users 쪽에서 "누가 나를 가리키나"를 알려면
   * 전 테이블의 제약을 눈으로 훑는 수밖에 없었다. 시드 계보: orders→users · products→categories ·
   * categories→categories(자기참조).
   */
  {
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="users"]').first().click()
    await page.waitForTimeout(250)
    check('참조하는 곳: users 에 칸이 선다', (await page.locator('[data-referenced-by="1"]').count()) === 1)
    check('참조하는 곳: 가리키는 쪽이 orders 로 적힌다', (await page.locator('[data-referenced-from="orders"]').count()) === 1)

    // 눌러서 가리키는 쪽으로 건너간다 — 그 표는 아무도 안 가리키니 칸 자체가 사라진다.
    await page.locator('[data-referenced-from="orders"]').first().click()
    await page.waitForTimeout(250)
    const jumped = await page.locator('[data-table-active="true"]').first().getAttribute('data-table-row')
    check('참조하는 곳: 누르면 그 테이블로 이동', jumped === 'orders')
    check('참조하는 곳: 아무도 안 가리키면 칸을 안 그린다', (await page.locator('[data-referenced-by]').count()) === 0)

    // 자기참조는 뺀다 — categories 는 자기 자신도 가리키지만 그 줄은 위 제약 목록이 이미 말한다.
    await page.locator('[data-table-row="categories"]').first().click()
    await page.waitForTimeout(250)
    check('참조하는 곳: 자기참조는 세지 않는다(categories)', (await page.locator('[data-referenced-by="1"]').count()) === 1)
    check('참조하는 곳: 남이 가리킨 것만 남는다(products)', (await page.locator('[data-referenced-from="products"]').count()) === 1)

    // 제약 탭의 방향 필터 — 이 표를 가리키는 것만(종류 필터와 축이 다르다).
    await page.locator('[data-table-row="users"]').first().click()
    await click('[data-side-tab="constraints"]')
    await page.waitForTimeout(200)
    await click('[data-constraint-incoming="off"]')
    await page.waitForTimeout(250)
    check(
      '제약 탭 방향 필터: users 를 가리키는 FK 한 줄만 남는다',
      (await page.locator('[data-constraint-row]').count()) === 1 &&
        (await page.locator('[data-constraint-row="fk_orders_user"]').count()) === 1
    )
    await click('[data-constraint-incoming="on"]') // 원위치 — 뒤 검사는 전체 목록을 본다
    await page.waitForTimeout(150)
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="orders"]').first().click()
    await page.waitForTimeout(200)
  }

  /*
   * ── 자기참조 표시 + 우클릭 복사 (2026-08-19 화면 피드백 두 건) ──
   * ⑴ 자기참조 FK 는 화살표 오른쪽 이름과 제목을 눈으로 대조해야 알 수 있었다 → 칩으로 못박는다.
   * ⑵ 앱 전역이 `user-select:none` 이라 값을 끌어 고를 수도 복사할 수도 없었다
   *    ("각 요소별로 내가 복사를 할 수가 없어. 드래그도 안되고"). 기본을 뒤집고 우클릭 메뉴를 달았다.
   * 시드 계보상 categories 만 자기 자신을 가리킨다.
   */
  {
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="categories"]').first().click()
    await page.waitForTimeout(300)
    const detail = await body()
    check('자기참조: categories 의 FK 줄에 칩이 붙는다', detail.includes('자기참조'))

    // 남을 가리키는 FK 에는 안 붙는다 — 늘 붙으면 표시가 뜻을 잃는다.
    await page.locator('[data-table-row="products"]').first().click()
    await page.waitForTimeout(300)
    check('자기참조: 남을 가리키는 FK 에는 안 붙는다(products)', !(await body()).includes('자기참조'))

    /*
     * 글자 선택의 두 갈래 — 전역 기본을 뒤집은 것의 회귀 가드.
     *  · 기본은 고를 수 있다(읽기 전용 화면은 이걸로 끌어 복사한다).
     *  · **클릭 편집칸은 못 고른다** — 여기서 끌면 손을 뗄 때 편집이 열려 고른 것이 날아간다.
     *    그 자리의 복사 수단은 우클릭 메뉴다(바로 아래 검사).
     */
    const userSelect = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).userSelect,
      editCell: (() => {
        const el = document.querySelector('[data-edit-cell]')
        return el ? getComputedStyle(el).userSelect : '없음'
      })()
    }))
    check(`글자 선택: 기본은 고를 수 있다 (문서 ${userSelect.root})`, userSelect.root === 'text')
    check(`글자 선택: 클릭 편집칸은 안 고른다 (${userSelect.editCell})`, userSelect.editCell === 'none')

    // 우클릭 복사 — 제약 목록의 한 줄에서 메뉴가 뜨고, 고른 값이 실제로 클립보드에 담긴다.
    await click('[data-side-tab="constraints"]')
    await page.waitForSelector('[data-constraint-row]', { timeout: 5_000 })
    await page.locator('[data-constraint-row]').first().click({ button: 'right' })
    await page.waitForTimeout(400)
    const items = await page.locator('[data-copy-item]').allInnerTexts()
    check(`우클릭 복사: 메뉴가 뜬다 (${items.join('·') || '없음'})`, items.includes('이름') && items.includes('줄 전체'))
    if (items.length > 0) {
      const want = await page.locator('[data-constraint-row]').first().getAttribute('data-constraint-row')
      await page.locator('[data-copy-item="이름"]').click()
      await page.waitForTimeout(250)
      const got = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
      check(`우클릭 복사: 고른 값이 클립보드에 담긴다 (${got})`, got === want)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="orders"]').first().click()
    await page.waitForTimeout(200)
  }

  // ── 사이드 패널 접기/펼치기 (DB 서비스 여섯 화면 공용 — §db-design.definition.side-panel AC-5) ──
  {
    // 접힌 패널은 **폭 0** 으로 눌릴 뿐 DOM 에는 남는다(검색어·고른 탭 유지). 안의 행은 잘려 있을
    // 뿐이라 `isVisible()` 로는 접힘을 못 가린다(실측) → 패널의 실제 폭으로 판정한다.
    const sidebarW = async () =>
      Math.round((await page.locator('[data-workspace-sidebar]').first().boundingBox())?.width ?? -1)
    const openW = await sidebarW()
    await click('[data-sidebar-collapse]')
    await page.waitForTimeout(400)
    check(
      'Design › Definition: 사이드 패널 접기 → 폭 0 + 펼치기 띠',
      openW > 0 && (await sidebarW()) === 0 && (await page.locator('[data-sidebar-expand]').count()) === 1
    )
    await click('[data-sidebar-expand]')
    await page.waitForTimeout(400)
    check(
      'Design › Definition: 세로 띠 → 펼치면 접기 전 폭으로 돌아온다',
      (await sidebarW()) === openW && (await page.locator('[data-sidebar-expand]').count()) === 0
    )
  }

  // ── Design › Definition — 뷰 선언(설계부에서 뷰 만들기 → 목록이 테이블/뷰로 갈린다) ──
  {
    await click('button[aria-label="테이블 추가"]')
    await page.waitForSelector('[data-definition-add="view"]', { timeout: 5_000 })
    await click('[data-definition-add="view"]')
    await page.waitForSelector('[data-definition-view-badge]', { timeout: 5_000 })
    check('Design › Definition: 뷰 추가 → 뷰 배지', (await page.locator('[data-definition-view-badge]').count()) === 1)
    // ⭐ 회귀 — 새로 만든 표·뷰에 **스키마가 붙어야** 한다(2026-08-04 제보). 안 붙던 동안은
    //    범위를 켠 설계에서 목록·다이어그램이 통째로 걸러 내, 눌러도 아무것도 안 뜨고 저장만 됐다.
    {
      const noSchema = await page.evaluate(async () =>
        (await window.rockury.tables.list()).filter((t) => !t.schema).map((t) => t.name)
      )
      check(`Design › Definition: 새 뷰에도 스키마가 붙는다 (${noSchema.join(',') || '없음'})`, noSchema.length === 0)
    }
    check('Design › Definition: 뷰엔 제약 구역이 없다', !(await body()).includes('제약 추가'))
    check('Design › Definition: 뷰 본문 편집기', (await page.locator('[data-view-body]').count()) === 1)
    // 목록이 테이블/뷰 구역으로 갈린다 — 이 화면이 Remote 와 같아지는 지점
    check('Design › Definition: 목록에 뷰 구역 등장', (await body()).includes('뷰'))

    // 본문 SELECT 를 쓰면 SQL 폼이 CREATE VIEW 로 나온다
    await page.locator('[data-view-body] .cm-content').click()
    await page.keyboard.type('SELECT id, order_number FROM orders')
    await page.waitForTimeout(400)
    await click('[data-definition-form="sql"]')
    await page.waitForTimeout(400)
    const sqlBody = await body()
    check('Design › Definition: 뷰 DDL 은 CREATE VIEW', sqlBody.includes('CREATE OR REPLACE VIEW'))
    check('Design › Definition: 뷰 DDL 에 CREATE TABLE 없음', !sqlBody.includes('CREATE TABLE'))
    check('Design › Definition: 뷰 DDL 에 본문 SELECT 포함', sqlBody.includes('SELECT id, order_number FROM orders'))
    await click('[data-definition-form="table"]')
    await page.waitForTimeout(250)

    // 저장 왕복 — 뷰 표식과 본문이 로컬 저장소까지 살아남는다
    await page.waitForTimeout(600)
    const storedView = await page.evaluate(async () => {
      const list = await window.rockury.tables.list()
      return list.filter((t) => t.designId === 'commerce-core' && t.isView).map((t) => t.viewSql)
    })
    check('Design › Definition: 뷰 선언·본문 저장 왕복', storedView.length === 1 && storedView[0].includes('SELECT id, order_number'))
  }

  // ⭐ 고른 표는 Definition ↔ Diagram 을 오가도 유지된다(2026-08-04 사용자 요청).
  //    Diagram 이 고름을 자기 화면 안에만 들고 있던 동안은 들어올 때마다 풀렸다.
  //    색으로만 드러나는 종류라 다른 게이트가 못 잡는다 → 여기서 못박는다.
  {
    const activeRow = async () =>
      page.locator('[data-table-active="true"]').first().getAttribute('data-table-row').catch(() => null)
    await page.locator('[data-table-row="products"]').first().click()
    await page.waitForTimeout(300)
    check('Design › Definition: 고른 표(products)가 활성으로 표시된다', (await activeRow()) === 'products')

    await click('button:has-text("Diagram")')
    await page.waitForTimeout(1_200)
    check(`Design › Diagram: 고른 표가 유지된다 (${await activeRow()})`, (await activeRow()) === 'products')

    // 반대 방향도 같다 — Diagram 에서 고르면 Definition 이 따라온다.
    await page.locator('[data-table-row="orders"]').first().click()
    await page.waitForTimeout(300)
    await click('button:has-text("Definition")')
    await page.waitForTimeout(800)
    check(`Design › Definition: Diagram 에서 고른 orders 로 따라온다 (${await activeRow()})`, (await activeRow()) === 'orders')
  }

  // Design › Diagram — 가상 ERD 편집기(설계 테이블 렌더 + 편집 + 설계 스코프 위치 영속).
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
  await page.waitForTimeout(300)
  check('Design › Diagram: 설계 ERD 노드 렌더(orders)', (await page.locator('.react-flow__node[data-id]').count()) > 0 && (await body()).includes('orders'))
  // 관계선 라벨(카드형: 1줄 `col → refCol` + 2줄 `D:/U:` 정책) — 자동 배치가 카드 폭만큼 랭크를
  // 벌려 잘리지 않고, 카드끼리도 안 겹치며, 호버하면 노드 위로 떠오른다(브라우저 기본 툴팁 아님).
  // 회귀: 라벨이 참조 테이블 밑에 깔려 글자가 잘렸고, 카드 2줄이면 이웃 FK 행 카드와 겹쳤다.
  {
    const cards = () =>
      page.evaluate(() => {
        const kids = [...document.querySelectorAll('.react-flow__edgelabel-renderer > div')]
        return kids
          .filter((el) => el.innerText.includes('→'))
          .map((el) => {
            const r = el.getBoundingClientRect()
            const box = el.firstElementChild
            return {
              text: el.innerText.trim(),
              self: el.innerText.includes('SELF'),
              z: getComputedStyle(el).zIndex,
              // 잘림 판정: 카드가 자기 내용을 다 담고 있나(scrollWidth ≤ clientWidth).
              fits: [...box.children].every((c) => c.scrollWidth <= c.clientWidth + 1),
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height
            }
          })
      })
    const before = await cards()
    check('Design › Diagram: 관계선 라벨 카드 렌더(정책 D:/U: 두 번째 줄)', before.some((c) => /D:|U:/.test(c.text)))
    check('Design › Diagram: 라벨 카드가 잘리지 않음(자동 배치가 카드 폭만큼 벌림)', before.length > 0 && before.every((c) => c.fits))
    // 카드끼리 세로 겹침 없음(레인 보정) — 자기참조 카드는 노드 위 루프라 판정에서 제외.
    const flat = before.filter((c) => !c.self)
    const overlap = flat.some((a, i) =>
      flat.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
    )
    check('Design › Diagram: 라벨 카드끼리 겹치지 않음', flat.length > 0 && overlap === false)
    if (flat.length) {
      const t = flat[0]
      await page.mouse.move(t.x + t.w / 2, t.y + t.h / 2)
      await page.waitForTimeout(300)
      const after = (await cards()).find((c) => c.text === t.text)
      check('Design › Diagram: 라벨 호버 → 노드 위로 떠오름(z-index)', after?.z === '10')
      // 기본 툴팁(title 속성)에 의존하지 않는다 — 자체 카드가 정본.
      const hasTitle = await page.evaluate(() =>
        [...document.querySelectorAll('.react-flow__edgelabel-renderer *')].some((el) => el.hasAttribute('title'))
      )
      check('Design › Diagram: 관계선 라벨에 브라우저 기본 툴팁(title) 없음', hasTitle === false)
      await page.mouse.move(4, 4) // 호버 해제
      await page.waitForTimeout(200)
    }
  }
  // 테이블 추가 → 노드 증가
  const beforeN = await page.locator('.react-flow__node[data-id]').count()
  await click('button:has-text("테이블 추가")')
  await page.waitForTimeout(500)
  const afterN = await page.locator('.react-flow__node[data-id]').count()
  check('Design › Diagram: 테이블 추가 → 노드 증가', afterN === beforeN + 1)
  // CASE-design-064 — 노드 선택 → 아래 상세 서랍이 **설계 편집 폼(Definition 화면)** 을 그대로 연다.
  await page.locator('.react-flow__node:not([data-id^="grp:"])').last().click()
  await page.waitForTimeout(400)
  check(
    'Design › Diagram: 노드 선택 → 상세 서랍이 설계 편집 폼을 연다',
    (await page.locator('[data-diagram-drawer="open"]').count()) > 0 &&
      (await page.locator('[data-diagram-drawer="open"]').innerText()).includes('제약')
  )
  /*
   * CASE-design-065 — **크게 보기 안에서도 칸 편집이 된다.**
   *   회귀(2026-08-18 화면 제보 "여기서 왜 편집이 안될까?"): 서랍과 모달이 같은 폼을 **동시에**
   *   그리던 동안, 칸을 눌러 뜬 입력칸이 한 프레임 만에 닫혔다. 뒤에 가려진 사본의 입력칸이
   *   자동 포커스를 집었다가 모달의 포커스 가둠에 밀려 blur → 그 blur 가 편집을 끝냈다.
   *   그래서 "입력칸이 떠서 남아 있는가"까지 본다 — 값만 보면 원인을 못 가른다.
   */
  {
    await page.locator('[data-drawer-expand]').first().click()
    await page.waitForTimeout(400)
    const modal = page.locator('[data-drawer-modal]')
    check('Design › Diagram: 크게 보기 → 모달', (await modal.count()) === 1)
    // 같은 폼이 두 벌 살아 있지 않다 — 컬럼 행의 드래그 손잡이가 한 벌치만 보인다.
    const grips = await page.locator('button[aria-label="드래그로 순서 변경"]').count()
    const gripsInModal = await modal.locator('button[aria-label="드래그로 순서 변경"]').count()
    check(
      `Design › Diagram(크게 보기): 편집 폼이 한 벌만 산다 (전체 ${grips} = 모달 ${gripsInModal})`,
      gripsInModal > 0 && grips === gripsInModal
    )

    await modal.locator('button:has-text("컬럼 추가")').last().click()
    await page.waitForTimeout(250)
    // 새로 붙은 컬럼의 Name 칸 — 편집칸은 placeholder 가 없으니 편집 키로 집는다.
    await modal.locator('[data-edit-cell^="col:"][data-edit-cell$=":name"]').last().click()
    await page.waitForTimeout(250)
    check(
      'Design › Diagram(크게 보기): 칸을 누르면 입력칸이 떠서 남는다',
      (await page.locator('[data-edit-input]').count()) === 1
    )
    await page.locator('[data-edit-input]').fill('probe_col')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    check('Design › Diagram(크게 보기): 입력값이 커밋된다', (await modal.innerText()).includes('probe_col'))

    await page.keyboard.press('Escape') // 모달 닫기
    await page.waitForTimeout(300)
    check('Design › Diagram: 모달 닫힘', (await page.locator('[data-drawer-modal]').count()) === 0)
    check(
      'Design › Diagram: 모달에서 고친 값이 서랍에도 그대로',
      (await page.locator('[data-diagram-drawer="open"]').innerText()).includes('probe_col')
    )
  }
  await page.locator('[data-drawer-toggle]').first().click() // 접어서 캔버스 자리를 돌려준다
  await page.waitForTimeout(250)
  // 드래그 → 설계 스코프(design:commerce-core) 위치 저장
  {
    // ⚠ 오버레이(미니맵·컨트롤·툴바)에 덮인 노드를 잡으면 mousedown 이 그쪽으로 가서 드래그가
    //   조용히 안 된다(회귀 실측: 창이 좁을 때 마지막 노드가 미니맵 아래로 들어가 실패).
    //   → hit-test 로 "실제로 집을 수 있는" 노드를 고른다.
    const target = await ctx.pickDraggableNode()
    check('Design › Diagram: 오버레이에 안 덮인 드래그 대상 노드 확보', !!target)
    const { nd, box, from } = target
    const tfPre = await nd.evaluate((el) => el.style.transform)
    const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    // ⚠ 드래그 끝점은 **반드시 창 안**이어야 한다. 창 밖에서 mouseup 하면 pointerup 이 페이지에
    //   닿지 않아 React Flow 의 onNodeDragStop 이 안 불리고 위치 저장이 통째로 스킵된다.
    //   (회귀: 마지막 노드가 창 아래쪽에 배치되면 목표 y 가 창 높이를 4px 넘어 간헐 실패했다.
    //    앱 버그가 아니라 합성 입력이 창을 벗어난 것 — 방향을 뒤집어 안쪽으로 끈다.)
    const to = {
      x: from.x + (from.x + 140 < win.w - 20 ? 140 : -140),
      y: from.y + (from.y + 90 < win.h - 20 ? 90 : -90)
    }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    // 드래그가 실제로 일어났는지 먼저 가른다 — 저장 실패와 "드래그 자체가 안 됨"을 구별해야
    // 다음에 깨졌을 때 원인을 바로 안다.
    check(
      'Design › Diagram: 드래그로 노드가 실제로 움직임',
      (await nd.evaluate((el) => el.style.transform)) !== tfPre
    )
    const saved = await page.evaluate(async () => {
      const l = await window.rockury.diagram.getLayout('design:commerce-core')
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Design › Diagram: 드래그 → 설계 레이아웃 저장', saved > 0)
    // 뷰 왕복 → 저장 위치 복원(회귀: seed 판정이 setNodes updater 안에 있으면
    // StrictMode(dev)에서 dagre 로 리셋되고 드래그 한 번에 저장 배치가 덮어써졌다)
    const dragId = await nd.getAttribute('data-id')
    const draggedTf = await nd.evaluate((el) => el.style.transform)
    await click('button:has-text("Definition")')
    await page.waitForTimeout(300)
    await click('button:has-text("Diagram")')
    await page.waitForSelector(`.react-flow__node[data-id="${dragId}"]`, { timeout: 10_000 })
    await page.waitForTimeout(500)
    const restoredTf = await page
      .locator(`.react-flow__node[data-id="${dragId}"]`)
      .first()
      .evaluate((el) => el.style.transform)
    check('Design › Diagram: 뷰 왕복 후 드래그 위치 복원', restoredTf === draggedTf)
  }

  // ⭐ CASE-design-063 — 그룹은 **설계 스코프**로 저장된다(Remote 와 같은 코드, 다른 스코프).
  {
    await page.locator('[data-side-tab="groups"]').first().click()
    await page.waitForTimeout(200)
    // 상단 도구줄의 `그룹 추가` — 왼쪽 `그룹` 탭을 열지 않고도 만들 수 있어야 한다.
    // (패널 안의 `+ 그룹` 은 07-remote-schema 가 덮는다.)
    await page.locator('[data-group-create-toolbar]').first().click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check('Design › Diagram: 도구줄 `그룹 추가` → 캔버스에 영역', (await page.locator('[data-erd-group="그룹 1"]').count()) > 0)

    // ⭐ 회귀 — 새 그룹 상자는 **지금 보고 있는 자리**에 생겨야 한다. 예전엔 테이블 무리 오른쪽
    //    바깥에 생겨, 표가 많아 배율이 낮으면 화면 구석의 점만 해서 끌어다 놓을 수가 없었다.
    const inView = await page.evaluate(() => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      const box = document.querySelector('[data-erd-group]')?.getBoundingClientRect()
      if (!pane || !box) return null
      return {
        inside: box.left > pane.left && box.right < pane.right && box.top > pane.top && box.bottom < pane.bottom,
        w: Math.round(box.width)
      }
    })
    check(
      'Design › Diagram: 새 그룹 상자가 보이는 캔버스 안에, 놓을 만한 크기로 생긴다',
      !!inView && inView.inside && inView.w > 120
    )

    // ⭐ 회귀 — 캔버스에서 표를 끌어 그룹에 넣는다. 예전엔 표의 **한가운데 점**으로 판정해
    //    컬럼 많은 긴 표(orders)는 빈 상자(180px)에 아무리 얹어도 안 들어갔다.
    {
      const box = await page.locator('[data-erd-group="그룹 1"]').first().boundingBox()
      const node = page.locator('.react-flow__node').filter({ hasText: 'orders' }).first()
      const nb = await node.boundingBox()
      if (box && nb) {
        await page.mouse.move(nb.x + nb.width / 2, nb.y + 10)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
        await page.mouse.up()
        await page.waitForTimeout(700)
      }
      // 접힌 그룹은 소속 행을 안 그린다 — 펴서 센다.
      await page.locator('[data-group-row="그룹 1"] button').first().click()
      await page.waitForTimeout(300)
      const names = await page
        .locator('[data-group-row="그룹 1"] [data-group-member]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-group-member')))
      check('Design › Diagram: 캔버스에서 표를 끌어 그룹에 넣는다(긴 표도)', names.includes('orders'))
    }

    const rows = page.locator('[data-group-member] select')
    if ((await rows.count()) > 0) {
      await rows.first().selectOption('g1')
      await page.waitForTimeout(250)
    }

    // 뷰를 떠났다 와도 남는다 + 저장 스코프가 설계 키다.
    await click('button:has-text("Definition")')
    await page.waitForTimeout(400)
    await click('button:has-text("Diagram")')
    await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
    await page.waitForTimeout(500)
    const savedGroups = await page.evaluate(async () => {
      const l = await window.rockury.diagram.getLayout('design:commerce-core')
      return (l?.groups ?? []).map((g) => g.name)
    })
    check('Design › Diagram: 그룹이 설계 스코프에 저장·복원된다', savedGroups.includes('그룹 1'))
    check(
      'Design › Diagram: 화면 왕복 후에도 그룹 영역이 그대로',
      (await page.locator('[data-erd-group="그룹 1"]').count()) > 0
    )
    // CASE-design-103 — 설계부에서만: 그룹과 소속 테이블을 **함께** 지운다(확인 문구 입력).
    //   지울 대상은 앞에서 추가한 새 테이블(`new_table_*`) 로 고른다 — 시드 설계 테이블을 지우면
    //   뒤 스위트(시드·버전)가 통째로 깨진다.
    {
      // 화면 왕복으로 좌측 패널이 다시 그려지면서 탭이 `테이블` 로 돌아왔다 — 그룹 탭으로 되돌린다.
      await page.locator('[data-side-tab="groups"]').first().click()
      await page.waitForTimeout(250)
      await page.locator('[data-group-create]').first().click()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const victimRow = page.locator('[data-group-member^="new_table_"]').first()
      const victimName = (await victimRow.count()) > 0 ? await victimRow.getAttribute('data-group-member') : null
      check('Design › Diagram: 지울 대상(새 테이블) 확보', !!victimName)
      if (victimName) {
        await victimRow.locator('select').first().selectOption('g2')
        await page.waitForTimeout(400)
        await page.locator('[data-group-delete="그룹 2"]').first().click()
        await page.waitForTimeout(400)
        check(
          'Design › Diagram: 지우기 → 확인 창에 테이블 동반 삭제 선택지',
          (await page.locator('[data-group-delete-dialog="그룹 2"]').count()) === 1 &&
            (await page.locator('[data-group-delete-with-tables]').count()) === 1
        )
        await page.locator('[data-group-delete-with-tables]').first().click()
        await page.waitForTimeout(300)
        const confirmBtn = page.locator('[data-group-delete-confirm]').first()
        check('Design › Diagram: 문구 입력 전에는 지우기가 잠겨 있다', await confirmBtn.isDisabled())
        await page.locator('[data-group-delete-phrase]').first().fill('테이블 지워줘')
        await page.waitForTimeout(250)
        check('Design › Diagram: 틀린 문구로는 안 열린다', await confirmBtn.isDisabled())
        await page.locator('[data-group-delete-phrase]').first().fill('1개 테이블도 함께 삭제합니다')
        await page.waitForTimeout(250)
        check('Design › Diagram: 문구가 맞으면 지우기가 열린다', !(await confirmBtn.isDisabled()))
        await confirmBtn.click()
        await page.waitForTimeout(800)
        check(
          'Design › Diagram: 그룹과 소속 테이블이 설계에서 사라진다',
          (await page.locator('[data-group-row="그룹 2"]').count()) === 0
        )
        await page.locator('[data-side-tab="tables"]').first().click()
        await page.waitForTimeout(300)
        check(
          'Design › Diagram: 지운 테이블이 목록에도 없다',
          (await page.locator(`[data-table-row="${victimName}"]`).count()) === 0
        )
      }
    }

    await page.locator('[data-side-tab="tables"]').first().click()
    await page.waitForTimeout(150)
  }

  /*
   * ── 다른 설계의 테이블 가져오기(복제) — 2026-08-02 요청, 2026-08-20 마감 ──
   * **복제이지 동기화가 아니다** — 떠 온 뒤로 원본과 줄이 끊긴다. 여기서 못 박는 것 다섯:
   *  ⑴ 손잡이는 **가져올 곳이 있을 때만** 뜬다(설계가 하나뿐이면 고를 출처가 없다).
   *  ⑵ FK 로 엮인 표가 딸려오고, 복제본끼리 관계가 다시 붙는다.
   *  ⑶ 이름이 겹치면 `_copy` 를 받거나(rename) 통째로 건너뛴다(skip) — 사람이 고른다.
   *  ⑷ 출처 설계는 안 다친다.
   *  ⑸ 껐다 켜도 남는다(write-through 가 받는가).
   * 임시 설계는 **지우고 나간다** — 남기면 뒤 스위트의 설계 선택이 흔들린다.
   */
  {
    const designCount = await page.evaluate(async () => (await window.rockury.designs.list()).length)
    if (designCount === 1) {
      check('Design › Diagram: 가져올 곳이 없으면 가져오기 손잡이도 없다', (await page.locator('[data-import-tables]').count()) === 0)
    }

    // 빈 설계를 하나 만들어 그리로 옮긴다 — 벤더는 출처와 같게(벤더 경고는 여기 관심사가 아니다).
    const tmpId = await page.evaluate(async () => {
      const d = await window.rockury.designs.create({ name: 'e2e-copy-into', dialect: 'mysql', description: '' })
      // 칸(`service2`)에 든 표 하나 — 들어오는 칸 없는 orders 와 **안 겹쳐야** 한다.
      await window.rockury.tables.replaceForDesign(d.id, [
        {
          id: 'e2e-s2-orders',
          designId: d.id,
          schema: 'service2',
          name: 'orders',
          comment: '',
          columns: [{ id: 'e2e-c1', name: 'id', type: 'bigint', nullable: false, defaultValue: null, comment: '' }],
          constraints: []
        }
      ])
      window.__rockuryNav.setContextValue('design', d.id)
      return d.id
    })
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })
    await click('button:has-text("Design")')
    await click('button:has-text("Diagram")')
    await page.waitForTimeout(800)
    check('Design › Diagram: 가져올 곳이 생기면 손잡이가 뜬다', (await page.locator('[data-import-tables]').count()) > 0)

    await page.locator('[data-import-tables]').first().click()
    await page.waitForSelector('[data-import-dialog]', { timeout: 5_000 })
    check('가져오기: 모달이 열린다', (await page.locator('[data-import-dialog]').count()) === 1)

    /*
     * 기본 출처는 **이 설계 자신**이다(복붙이 이 창의 첫 쓰임 · 2026-08-20).
     * 그래서 남의 설계에서 떠 오는 아래 검사들은 출처를 **명시해서** 고른다.
     */
    check('가져오기: 기본 출처는 이 설계 자신(복붙)', (await page.locator('[data-import-source]').first().getAttribute('data-import-source')) === tmpId)
    check('복붙: 이 설계의 표가 목록에 선다(service2.orders)', (await page.locator('[data-import-row="orders"]').count()) === 1)
    await click('[data-import-all]')
    await page.waitForTimeout(300)
    check('복붙: 자기 자신이라 이름이 겹쳐 복사본 이름을 받는다', (await page.locator('[data-import-dest="service2.orders_copy"]').count()) === 1)

    await page.locator('[data-import-source]').first().click()
    await page.waitForTimeout(400)
    await page.locator('[role="option"]:has-text("commerce-core")').first().click()
    await page.waitForTimeout(500)
    check('가져오기: 출처를 다른 설계로 바꾼다(commerce-core)', (await page.locator('[data-import-source]').first().getAttribute('data-import-source')) === 'commerce-core')

    // 한 표만 고른다 — FK 로 엮인 것이 딸려오는지 보려고(orders → users).
    await page.locator('[data-import-row="orders"]').first().click()
    await page.waitForTimeout(300)
    check('가져오기: FK 로 엮인 표가 딸려온다(orders → users)', (await page.locator('[data-import-submit]').first().getAttribute('data-import-submit')) === '2')

    await click('[data-import-all]')
    await page.waitForTimeout(300)
    check('가져오기: 전체 선택 = 시드 4표', (await page.locator('[data-import-submit]').first().getAttribute('data-import-submit')) === '4')
    check('가져오기: 칸이 다르면 이름이 같아도 안 겹친다(service2.orders ≠ orders)', (await page.locator('[data-import-rename]').count()) === 0)

    await page.locator('[data-import-submit]').first().click()
    await page.waitForTimeout(1200)
    check('가져오기: 4표가 이 설계로 복제된다', (await page.locator('[data-table-row="orders"]').count()) === 1 && (await page.locator('[data-table-row="users"]').count()) === 1)

    // 복제본끼리 관계가 다시 붙었나 — 받는 설계 안에서 users 를 가리키는 FK 가 선다.
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="users"]').first().click()
    await page.waitForTimeout(400)
    check('가져오기: 복제본끼리 FK 가 다시 이어진다(users ← orders)', (await page.locator('[data-referenced-from="orders"]').count()) === 1)

    // 한 번 더 — 이번엔 이름이 다 겹친다.
    await page.locator('[data-import-tables]').first().click()
    await page.waitForSelector('[data-import-dialog]', { timeout: 5_000 })
    // 창을 다시 열면 출처가 자기 자신으로 되돌아간다(열 때마다 초기화) — 다시 골라 준다.
    await page.locator('[data-import-source]').first().click()
    await page.waitForTimeout(400)
    await page.locator('[role="option"]:has-text("commerce-core")').first().click()
    await page.waitForTimeout(500)
    await click('[data-import-all]')
    await page.waitForTimeout(300)
    check('가져오기: 이름이 겹치면 복사본 이름을 준다(orders_copy)', (await page.locator('[data-import-rename="orders_copy"]').count()) === 1)
    /*
     * 받는 스키마 — **어느 스키마로 넣을지**. 옮기면 겹침 판정도 그 스키마 기준으로 따라간다.
     * 지금 이 설계엔 칸 없는 4표 + `service2.orders` 가 있다. 그래서:
     *   출처 그대로 → 넷 다 겹친다(위 검사) · service2 로 → `orders` 만 겹친다.
     */
    check('받는 스키마: 스키마가 있는 설계에서만 줄이 뜬다', (await page.locator('[data-import-into]').count()) === 1)
    check('받는 스키마: 기본은 출처와 같음', (await page.locator('[data-import-into]').first().getAttribute('data-import-into')) === '__as-is__')
    await page.locator('[data-import-into]').first().click()
    await page.waitForTimeout(400)
    await page.locator('[role="option"]:has-text("service2")').first().click()
    await page.waitForTimeout(500)
    check(
      '받는 스키마: service2 로 옮기면 그 스키마 기준으로 겹침을 다시 센다(orders 만)',
      (await page.locator('[data-import-rename="orders_copy"]').count()) === 1 &&
        (await page.locator('[data-import-rename]').count()) === 1
    )
    check(
      '받는 스키마: 줄마다 가는 곳을 한정 이름으로 찍는다(service2.orders_copy)',
      (await page.locator('[data-import-dest="service2.orders_copy"]').count()) === 1 &&
        (await page.locator('[data-import-dest="service2.users"]').count()) === 1
    )
    await click('[data-import-collision="skip"]')
    await page.waitForTimeout(300)
    check('가져오기: 건너뛰기로 바꾸면 겹친 것만 빠진다(service2 기준 orders 하나)', (await page.locator('[data-import-submit]').first().getAttribute('data-import-submit')) === '3' && (await page.locator('[data-import-skip]').count()) === 1)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // 출처는 안 다쳤나 + 뒷정리(임시 설계 삭제 → 원래 설계로 복귀).
    const counts = await page.evaluate(async () => {
      const rows = await window.rockury.tables.list()
      const by = {}
      for (const r of rows) by[r.designId] = (by[r.designId] ?? 0) + 1
      return by
    })
    check(`가져오기: 출처 설계는 그대로다 (commerce-core ${counts['commerce-core']}표)`, counts['commerce-core'] === 4)


    /*
     * ── 컬럼을 여러 표에 한 번에 (2026-08-20 사용자 요청: "동일 컬럼을 여러 테이블에 추가할 때
     *    일일이 하나씩 입력해야 한다") ──
     * 위에서 복제해 온 표들이 이 임시 설계에 있다. `products` 의 컬럼 하나를 `users` 에 뿌린다.
     * 이름이 겹치는 표(`orders` 가 둘)는 안 쓴다 — 이름으로 집는 로케이터가 흔들린다.
     */
    await click('button:has-text("Definition")')
    await page.waitForTimeout(600)
    await click('[data-side-tab="tables"]')
    await page.locator('[data-table-row="products"]').first().click()
    await page.waitForTimeout(500)
    await page.locator('button[aria-label="더 보기"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-open]').first().click()
    await page.waitForSelector('[data-addcols-dialog]', { timeout: 5_000 })
    check('컬럼 뿌리기: 대상에 자기 자신은 없다', (await page.locator('[data-addcols-target="products"]').count()) === 0)
    /*
     * 두 칸의 높이 — 2026-08-20 화면 피드백("이거 UI 왜이래?"). 왼쪽이 컬럼 수만큼 길어지는 동안
     * 오른쪽은 표 몇 줄에서 끊겨 밑이 안 맞았다. 높이는 바깥 격자가 정하고 안쪽이 채운다.
     */
    {
      const box = await page.evaluate(() => {
        const dlg = document.querySelector('[data-addcols-dialog]')
        const grid = [...dlg.querySelectorAll('div')].find((d) => d.className.includes('grid-cols-2'))
        return [...grid.children].map((c) => {
          const r = c.querySelector('.overflow-auto').getBoundingClientRect()
          return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
        })
      })
      check(
        `컬럼 뿌리기: 두 칸의 윗변·밑변이 맞는다 (${box[0].top}~${box[0].bottom} vs ${box[1].top}~${box[1].bottom})`,
        box.length === 2 && box[0].top === box[1].top && box[0].bottom === box[1].bottom
      )
    }

    await page.locator('[data-addcols-col="sku"]').first().click()
    await page.locator('[data-addcols-target="users"]').first().click()
    await page.waitForTimeout(400)
    check('컬럼 뿌리기: 고른 대상 줄에 결과가 미리 뜬다', (await page.locator('[data-addcols-summary="+sku"]').count()) === 1)
    check('컬럼 뿌리기: 바뀔 표 수가 버튼에 적힌다', (await page.locator('[data-addcols-submit]').first().getAttribute('data-addcols-submit')) === '1')
    await page.locator('[data-addcols-submit]').first().click()
    await page.waitForTimeout(900)
    await page.locator('[data-table-row="users"]').first().click()
    await page.waitForTimeout(500)
    check('컬럼 뿌리기: 대상 표에 컬럼이 생긴다', (await body()).includes('sku'))
    // 두 번째: 같은 것을 또 넣으면 "이미 있음", 덮어쓰기로 바꾸면 "덮어씀".
    await page.locator('[data-table-row="products"]').first().click()
    await page.waitForTimeout(400)
    await page.locator('button[aria-label="더 보기"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-open]').first().click()
    await page.waitForSelector('[data-addcols-dialog]', { timeout: 5_000 })
    await page.locator('[data-addcols-col="sku"]').first().click()
    await page.locator('[data-addcols-target="users"]').first().click()
    await page.waitForTimeout(400)
    check('컬럼 뿌리기: 겹치면 "이미 있음"', (await page.locator('[data-addcols-summary="이미 있음 sku"]').count()) === 1)
    check('컬럼 뿌리기: 바뀔 게 없으면 넣기가 잠긴다', await page.locator('[data-addcols-submit]').first().isDisabled())
    await click('[data-addcols-collision="overwrite"]')
    await page.waitForTimeout(400)
    check('컬럼 뿌리기: 덮어쓰기로 바꾸면 "덮어씀"', (await page.locator('[data-addcols-summary="덮어씀 sku"]').count()) === 1)
    // 세 번째 갈래 — 사본 만들기. 겹치면 `_copy` 를 붙여 새로 넣고, 있던 컬럼은 손 안 댄다.
    await click('[data-addcols-collision="rename"]')
    await page.waitForTimeout(400)
    check('컬럼 뿌리기: 사본 만들기로 바꾸면 "사본"으로 뜬다', (await page.locator('[data-addcols-summary="사본 sku_copy"]').count()) === 1)
    check('컬럼 뿌리기: 사본만 생겨도 넣기가 열린다', !(await page.locator('[data-addcols-submit]').first().isDisabled()))

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)


    /*
     * ── 붙여넣기로 컬럼 만들기 (2026-08-20) ──
     * 엑셀에서 긁어온 모양(탭으로 나뉜 칸)을 그대로 붙인다. 머리글 줄은 빠지고, 못 읽은 줄은
     * 화면이 밝힌다. 설명 칸(`가입 시각`)까지 따라오는지가 이 검사의 핵심 — 예전엔 버려졌다.
     */
    await page.locator('button[aria-label="더 보기"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-open]').first().click()
    await page.waitForSelector('[data-addcols-dialog]', { timeout: 5_000 })
    await click('[data-addcols-mode="paste"]')
    await page.waitForTimeout(300)
    check('붙여넣기: 입력칸이 뜬다', (await page.locator('[data-addcols-paste]').count()) === 1)
    await page.locator('[data-addcols-paste]').fill('컬럼\t타입\nsigned_up_at\tDATETIME\tNOT NULL\t가입 시각\n-- 여긴 주석')
    await page.waitForTimeout(500)
    check('붙여넣기: 머리글은 빼고 컬럼만 읽는다', (await page.locator('[data-addcols-col]').count()) === 1 && (await page.locator('[data-addcols-col="signed_up_at"]').count()) === 1)
    check('붙여넣기: 못 읽은 줄을 밝힌다', (await page.locator('[data-addcols-dropped="1"]').count()) === 1)
    await page.locator('[data-addcols-target="users"]').first().click()
    await page.waitForTimeout(400)
    check('붙여넣기: 미리보기가 뜬다', (await page.locator('[data-addcols-summary="+signed_up_at"]').count()) === 1)
    await page.locator('[data-addcols-submit]').first().click()
    await page.waitForTimeout(900)
    const pasted = await page.evaluate(async () => {
      const rows = await window.rockury.tables.list()
      const t = rows.filter((r) => r.name === 'users').at(-1)
      return t.columns.find((c) => c.name === 'signed_up_at')
    })
    check(`붙여넣기: 타입·NOT NULL·설명이 함께 들어간다 (${pasted?.type} · ${pasted?.comment})`,
      pasted?.type === 'DATETIME' && pasted?.nullable === false && pasted?.comment === '가입 시각')


    /*
     * ── 컬럼 묶음(저장해 두고 다시 쓰기) — 2026-08-20 ⓒ ──
     * 묶음은 **설계에 안 매인다**(재활용이 존재 이유). 여기서는 만들고·고르고·넣고·지우는 한 바퀴만
     * 본다. 저장소에 남는지는 `stores.test.ts` 가 덮는다.
     */
    await page.locator('button[aria-label="더 보기"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-open]').first().click()
    await page.waitForSelector('[data-addcols-dialog]', { timeout: 5_000 })
    check('묶음: 출처 갈래가 셋이다', (await page.locator('[data-addcols-mode]').count()) === 3)
    await click('[data-addcols-mode="paste"]')
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-paste]').fill('audited_at\tDATETIME\tNOT NULL\t감사 시각')
    await page.waitForTimeout(500)
    await page.locator('[data-addcols-save-name]').fill('감사-묶음')
    await page.waitForTimeout(200)
    await page.locator('[data-addcols-save]').click()
    await page.waitForTimeout(800)
    // 같은 이름은 두 번 저장 안 된다 — 목록이 이름으로만 서서 둘을 가릴 길이 없다.
    await page.locator('[data-addcols-save-name]').fill('감사-묶음')
    await page.waitForTimeout(200)
    await page.locator('[data-addcols-save]').click()
    await page.waitForTimeout(700)
    const dupMsg = await page.evaluate(
      () => document.querySelector('[data-addcols-save-error]')?.textContent?.trim() ?? ''
    )
    check(`묶음: 같은 이름이면 사유가 뜬다 (${dupMsg.slice(0, 40)})`, dupMsg.includes('이미 있습니다'))

    await click('[data-addcols-mode="set"]')
    await page.waitForTimeout(400)
    check('묶음: 저장한 것이 목록에 뜬다', (await page.locator('[data-addcols-set="감사-묶음"]').count()) === 1)
    check('묶음 모드에선 저장 칸을 안 낸다 — 이미 묶음이다', (await page.locator('[data-addcols-save-name]').count()) === 0)
    await page.locator('[data-addcols-set="감사-묶음"]').click()
    await page.waitForTimeout(400)
    check('묶음: 고르면 컬럼이 다 골라진 채로 뜬다', (await page.locator('[data-addcols-col="audited_at"]').count()) === 1)
    await page.locator('[data-addcols-target="users"]').first().click()
    await page.waitForTimeout(400)
    check('묶음: 미리보기가 뜬다', (await page.locator('[data-addcols-summary="+audited_at"]').count()) === 1)
    await page.locator('[data-addcols-submit]').first().click()
    await page.waitForTimeout(900)
    const fromSet = await page.evaluate(async () => {
      const rows = await window.rockury.tables.list()
      const t = rows.filter((r) => r.name === 'users').at(-1)
      return t.columns.find((c) => c.name === 'audited_at')
    })
    check(`묶음: 값까지 함께 들어간다 (${fromSet?.type} · ${fromSet?.comment})`,
      fromSet?.type === 'DATETIME' && fromSet?.nullable === false && fromSet?.comment === '감사 시각')
    // 뒷정리 — 묶음은 설계와 함께 안 지워지므로 여기서 손으로 치운다(뒤 스위트에 남으면 안 된다).
    await page.locator('button[aria-label="더 보기"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-addcols-open]').first().click()
    await page.waitForSelector('[data-addcols-dialog]', { timeout: 5_000 })
    await click('[data-addcols-mode="set"]')
    await page.waitForTimeout(400)
    await page.locator('[data-addcols-set-delete="감사-묶음"]').click()
    await page.waitForTimeout(700)
    check('묶음: 지우면 목록에서 사라진다', (await page.locator('[data-addcols-set="감사-묶음"]').count()) === 0)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    await page.evaluate(async (id) => {
      await window.rockury.designs.delete(id)
      window.__rockuryNav.setContextValue('design', 'commerce-core')
    }, tmpId)
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 15_000 })
    await click('button:has-text("Design")')
    await click('button:has-text("Definition")')
    await page.waitForTimeout(600)
    check('가져오기: 뒷정리 — 임시 설계를 지우고 원래 설계로 돌아온다', (await body()).includes('orders'))
  }
}
