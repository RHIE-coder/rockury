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
}
