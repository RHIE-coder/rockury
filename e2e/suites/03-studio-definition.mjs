// 스모크 스위트 — Studio › Definition(제약 탭·뷰 선언) + Studio › Diagram(가상 ERD 편집·라벨)
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '03-studio-definition',
  needsDb: false,
  desc: 'Studio › Definition(제약 탭·뷰 선언) + Studio › Diagram(가상 ERD 편집·라벨)'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Studio › Definition — 시드 테이블
  await click('button:has-text("Studio")')
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=orders', { timeout: 5_000 })
  check('Definition: 시드 테이블(orders) 표시', (await body()).includes('orders'))

  // ── Studio › Definition — 사이드 패널 제약 탭(Console 과 같은 구성) ──
  {
    await click('[data-side-tab="constraints"]')
    await page.waitForSelector('[data-constraint-group]', { timeout: 5_000 })
    check('Studio › Definition: 제약 탭에 테이블별 그룹', (await page.locator('[data-constraint-group]').count()) > 0)
    check('Studio › Definition: 제약 행 표시(pk_orders)', (await page.locator('[data-constraint-row="pk_orders"]').count()) === 1)
    // 종류 필터 — FK 만 남기면 pk 행이 사라진다
    await click('[data-constraint-filter="fk"]')
    await page.waitForTimeout(200)
    check('Studio › Definition: 제약 종류 필터(FK)', (await page.locator('[data-constraint-row="pk_orders"]').count()) === 0)
    await click('[data-constraint-filter="ALL"]')
    await page.waitForTimeout(150)
    // 제약을 누르면 그 제약이 걸린 테이블로 이동한다
    await click('[data-constraint-row="pk_orders"]')
    await page.waitForTimeout(250)
    await click('[data-side-tab="tables"]')
    await page.waitForTimeout(200)
    check('Studio › Definition: 제약 클릭 → 그 테이블로 이동', (await body()).includes('orders'))
  }

  // ── Studio › Definition — 뷰 선언(설계부에서 뷰 만들기 → 목록이 테이블/뷰로 갈린다) ──
  {
    await click('button[aria-label="테이블 추가"]')
    await page.waitForSelector('[data-definition-add="view"]', { timeout: 5_000 })
    await click('[data-definition-add="view"]')
    await page.waitForSelector('[data-definition-view-badge]', { timeout: 5_000 })
    check('Studio › Definition: 뷰 추가 → 뷰 배지', (await page.locator('[data-definition-view-badge]').count()) === 1)
    check('Studio › Definition: 뷰엔 제약 구역이 없다', !(await body()).includes('제약 추가'))
    check('Studio › Definition: 뷰 본문 편집기', (await page.locator('[data-view-body]').count()) === 1)
    // 목록이 테이블/뷰 구역으로 갈린다 — 이 화면이 Console 과 같아지는 지점
    check('Studio › Definition: 목록에 뷰 구역 등장', (await body()).includes('뷰'))

    // 본문 SELECT 를 쓰면 SQL 폼이 CREATE VIEW 로 나온다
    await page.locator('[data-view-body] .cm-content').click()
    await page.keyboard.type('SELECT id, order_number FROM orders')
    await page.waitForTimeout(400)
    await click('[data-definition-form="sql"]')
    await page.waitForTimeout(400)
    const sqlBody = await body()
    check('Studio › Definition: 뷰 DDL 은 CREATE VIEW', sqlBody.includes('CREATE OR REPLACE VIEW'))
    check('Studio › Definition: 뷰 DDL 에 CREATE TABLE 없음', !sqlBody.includes('CREATE TABLE'))
    check('Studio › Definition: 뷰 DDL 에 본문 SELECT 포함', sqlBody.includes('SELECT id, order_number FROM orders'))
    await click('[data-definition-form="table"]')
    await page.waitForTimeout(250)

    // 저장 왕복 — 뷰 표식과 본문이 로컬 저장소까지 살아남는다
    await page.waitForTimeout(600)
    const storedView = await page.evaluate(async () => {
      const list = await window.rockury.tables.list()
      return list.filter((t) => t.designId === 'commerce-core' && t.isView).map((t) => t.viewSql)
    })
    check('Studio › Definition: 뷰 선언·본문 저장 왕복', storedView.length === 1 && storedView[0].includes('SELECT id, order_number'))
  }

  // Studio › Diagram — 가상 ERD 편집기(설계 테이블 렌더 + 편집 + 설계 스코프 위치 영속).
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
  await page.waitForTimeout(300)
  check('Studio › Diagram: 설계 ERD 노드 렌더(orders)', (await page.locator('.react-flow__node[data-id]').count()) > 0 && (await body()).includes('orders'))
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
    check('Studio › Diagram: 관계선 라벨 카드 렌더(정책 D:/U: 두 번째 줄)', before.some((c) => /D:|U:/.test(c.text)))
    check('Studio › Diagram: 라벨 카드가 잘리지 않음(자동 배치가 카드 폭만큼 벌림)', before.length > 0 && before.every((c) => c.fits))
    // 카드끼리 세로 겹침 없음(레인 보정) — 자기참조 카드는 노드 위 루프라 판정에서 제외.
    const flat = before.filter((c) => !c.self)
    const overlap = flat.some((a, i) =>
      flat.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
    )
    check('Studio › Diagram: 라벨 카드끼리 겹치지 않음', flat.length > 0 && overlap === false)
    if (flat.length) {
      const t = flat[0]
      await page.mouse.move(t.x + t.w / 2, t.y + t.h / 2)
      await page.waitForTimeout(300)
      const after = (await cards()).find((c) => c.text === t.text)
      check('Studio › Diagram: 라벨 호버 → 노드 위로 떠오름(z-index)', after?.z === '10')
      // 기본 툴팁(title 속성)에 의존하지 않는다 — 자체 카드가 정본.
      const hasTitle = await page.evaluate(() =>
        [...document.querySelectorAll('.react-flow__edgelabel-renderer *')].some((el) => el.hasAttribute('title'))
      )
      check('Studio › Diagram: 관계선 라벨에 브라우저 기본 툴팁(title) 없음', hasTitle === false)
      await page.mouse.move(4, 4) // 호버 해제
      await page.waitForTimeout(200)
    }
  }
  // 테이블 추가 → 노드 증가
  const beforeN = await page.locator('.react-flow__node[data-id]').count()
  await click('button:has-text("테이블 추가")')
  await page.waitForTimeout(500)
  const afterN = await page.locator('.react-flow__node[data-id]').count()
  check('Studio › Diagram: 테이블 추가 → 노드 증가', afterN === beforeN + 1)
  // 노드 선택 → 편집 패널(컬럼/관계) 등장
  await page.locator('.react-flow__node[data-id]').last().click()
  await page.waitForTimeout(300)
  check('Studio › Diagram: 노드 선택 → 편집 패널', (await body()).includes('관계(FK)'))
  // 드래그 → 설계 스코프(design:commerce-core) 위치 저장
  {
    // ⚠ 오버레이(미니맵·컨트롤·툴바)에 덮인 노드를 잡으면 mousedown 이 그쪽으로 가서 드래그가
    //   조용히 안 된다(회귀 실측: 창이 좁을 때 마지막 노드가 미니맵 아래로 들어가 실패).
    //   → hit-test 로 "실제로 집을 수 있는" 노드를 고른다.
    const target = await ctx.pickDraggableNode()
    check('Studio › Diagram: 오버레이에 안 덮인 드래그 대상 노드 확보', !!target)
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
      'Studio › Diagram: 드래그로 노드가 실제로 움직임',
      (await nd.evaluate((el) => el.style.transform)) !== tfPre
    )
    const saved = await page.evaluate(async () => {
      const l = await window.rockury.diagram.getLayout('design:commerce-core')
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Studio › Diagram: 드래그 → 설계 레이아웃 저장', saved > 0)
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
    check('Studio › Diagram: 뷰 왕복 후 드래그 위치 복원', restoredTf === draggedTf)
  }
}
