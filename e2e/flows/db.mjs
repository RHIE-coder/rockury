/**
 * DB 서비스 앱 구동 흐름 — 설계부(Studio/Versions)와 운영부(Connections/Console/Migration).
 *
 * 새 DB 흐름은 **이 파일에만** 더한다(누적 자산 — 지우지 않는다, AGENTS.md 불변식 3).
 * 다른 서비스 흐름 파일이나 `e2e/smoke.mjs` 는 건드리지 않는다.
 *
 * ⚠ `ctx.page` 를 구조분해하지 말 것 — 콜드 재시작이 창 객체를 갈아끼운다.
 */
export async function run(ctx) {
  const { check, click, body, typeSql } = ctx

  // 설계 선택
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await ctx.page.waitForTimeout(300)

  // Studio › Definition — 시드 테이블
  await click('button:has-text("Studio")')
  await click('button:has-text("Definition")')
  await ctx.page.waitForSelector('text=orders', { timeout: 5_000 })
  check('Definition: 시드 테이블(orders) 표시', (await body()).includes('orders'))

  // ── Studio › Definition — 사이드 패널 제약 탭(Console 과 같은 구성) ──
  {
    await click('[data-side-tab="constraints"]')
    await ctx.page.waitForSelector('[data-constraint-group]', { timeout: 5_000 })
    check('Studio › Definition: 제약 탭에 테이블별 그룹', (await ctx.page.locator('[data-constraint-group]').count()) > 0)
    check('Studio › Definition: 제약 행 표시(pk_orders)', (await ctx.page.locator('[data-constraint-row="pk_orders"]').count()) === 1)
    // 종류 필터 — FK 만 남기면 pk 행이 사라진다
    await click('[data-constraint-filter="fk"]')
    await ctx.page.waitForTimeout(200)
    check('Studio › Definition: 제약 종류 필터(FK)', (await ctx.page.locator('[data-constraint-row="pk_orders"]').count()) === 0)
    await click('[data-constraint-filter="ALL"]')
    await ctx.page.waitForTimeout(150)
    // 제약을 누르면 그 제약이 걸린 테이블로 이동한다
    await click('[data-constraint-row="pk_orders"]')
    await ctx.page.waitForTimeout(250)
    await click('[data-side-tab="tables"]')
    await ctx.page.waitForTimeout(200)
    check('Studio › Definition: 제약 클릭 → 그 테이블로 이동', (await body()).includes('orders'))
  }

  // ── Studio › Definition — 뷰 선언(설계부에서 뷰 만들기 → 목록이 테이블/뷰로 갈린다) ──
  {
    await click('button[aria-label="테이블 추가"]')
    await ctx.page.waitForSelector('[data-definition-add="view"]', { timeout: 5_000 })
    await click('[data-definition-add="view"]')
    await ctx.page.waitForSelector('[data-definition-view-badge]', { timeout: 5_000 })
    check('Studio › Definition: 뷰 추가 → 뷰 배지', (await ctx.page.locator('[data-definition-view-badge]').count()) === 1)
    check('Studio › Definition: 뷰엔 제약 구역이 없다', !(await body()).includes('제약 추가'))
    check('Studio › Definition: 뷰 본문 편집기', (await ctx.page.locator('[data-view-body]').count()) === 1)
    // 목록이 테이블/뷰 구역으로 갈린다 — 이 화면이 Console 과 같아지는 지점
    check('Studio › Definition: 목록에 뷰 구역 등장', (await body()).includes('뷰'))

    // 본문 SELECT 를 쓰면 SQL 폼이 CREATE VIEW 로 나온다
    await ctx.page.locator('[data-view-body] .cm-content').click()
    await ctx.page.keyboard.type('SELECT id, order_number FROM orders')
    await ctx.page.waitForTimeout(400)
    await click('[data-definition-form="sql"]')
    await ctx.page.waitForTimeout(400)
    const sqlBody = await body()
    check('Studio › Definition: 뷰 DDL 은 CREATE VIEW', sqlBody.includes('CREATE OR REPLACE VIEW'))
    check('Studio › Definition: 뷰 DDL 에 CREATE TABLE 없음', !sqlBody.includes('CREATE TABLE'))
    check('Studio › Definition: 뷰 DDL 에 본문 SELECT 포함', sqlBody.includes('SELECT id, order_number FROM orders'))
    await click('[data-definition-form="table"]')
    await ctx.page.waitForTimeout(250)

    // 저장 왕복 — 뷰 표식과 본문이 로컬 저장소까지 살아남는다
    await ctx.page.waitForTimeout(600)
    const storedView = await ctx.page.evaluate(async () => {
      const list = await window.rockury.tables.list()
      return list.filter((t) => t.designId === 'commerce-core' && t.isView).map((t) => t.viewSql)
    })
    check('Studio › Definition: 뷰 선언·본문 저장 왕복', storedView.length === 1 && storedView[0].includes('SELECT id, order_number'))
  }

  // Studio › Diagram — 가상 ERD 편집기(설계 테이블 렌더 + 편집 + 설계 스코프 위치 영속).
  await click('button:has-text("Diagram")')
  await ctx.page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
  await ctx.page.waitForTimeout(300)
  check('Studio › Diagram: 설계 ERD 노드 렌더(orders)', (await ctx.page.locator('.react-flow__node[data-id]').count()) > 0 && (await body()).includes('orders'))
  // 테이블 추가 → 노드 증가
  const beforeN = await ctx.page.locator('.react-flow__node[data-id]').count()
  await click('button:has-text("테이블 추가")')
  await ctx.page.waitForTimeout(500)
  const afterN = await ctx.page.locator('.react-flow__node[data-id]').count()
  check('Studio › Diagram: 테이블 추가 → 노드 증가', afterN === beforeN + 1)
  // 노드 선택 → 편집 패널(컬럼/관계) 등장
  await ctx.page.locator('.react-flow__node[data-id]').last().click()
  await ctx.page.waitForTimeout(300)
  check('Studio › Diagram: 노드 선택 → 편집 패널', (await body()).includes('관계(FK)'))
  // 드래그 → 설계 스코프(design:commerce-core) 위치 저장
  {
    const nd = ctx.page.locator('.react-flow__node[data-id]').last()
    const box = await nd.boundingBox()
    const tfPre = await nd.evaluate((el) => el.style.transform)
    const win = await ctx.page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    const from = { x: box.x + box.width / 2, y: box.y + 8 }
    // ⚠ 드래그 끝점은 **반드시 창 안**이어야 한다. 창 밖에서 mouseup 하면 pointerup 이 페이지에
    //   닿지 않아 React Flow 의 onNodeDragStop 이 안 불리고 위치 저장이 통째로 스킵된다.
    //   (회귀: 마지막 노드가 창 아래쪽에 배치되면 목표 y 가 창 높이를 4px 넘어 간헐 실패했다.
    //    앱 버그가 아니라 합성 입력이 창을 벗어난 것 — 방향을 뒤집어 안쪽으로 끈다.)
    const to = {
      x: from.x + (from.x + 140 < win.w - 20 ? 140 : -140),
      y: from.y + (from.y + 90 < win.h - 20 ? 90 : -90)
    }
    await ctx.page.mouse.move(from.x, from.y)
    await ctx.page.mouse.down()
    await ctx.page.mouse.move(to.x, to.y, { steps: 8 })
    await ctx.page.mouse.up()
    await ctx.page.waitForTimeout(500)
    // 드래그가 실제로 일어났는지 먼저 가른다 — 저장 실패와 "드래그 자체가 안 됨"을 구별해야
    // 다음에 깨졌을 때 원인을 바로 안다.
    check(
      'Studio › Diagram: 드래그로 노드가 실제로 움직임',
      (await nd.evaluate((el) => el.style.transform)) !== tfPre
    )
    const saved = await ctx.page.evaluate(async () => {
      const l = await window.rockury.diagram.getLayout('design:commerce-core')
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Studio › Diagram: 드래그 → 설계 레이아웃 저장', saved > 0)
    // 뷰 왕복 → 저장 위치 복원(회귀: seed 판정이 setNodes updater 안에 있으면
    // StrictMode(dev)에서 dagre 로 리셋되고 드래그 한 번에 저장 배치가 덮어써졌다)
    const dragId = await nd.getAttribute('data-id')
    const draggedTf = await nd.evaluate((el) => el.style.transform)
    await click('button:has-text("Definition")')
    await ctx.page.waitForTimeout(300)
    await click('button:has-text("Diagram")')
    await ctx.page.waitForSelector(`.react-flow__node[data-id="${dragId}"]`, { timeout: 10_000 })
    await ctx.page.waitForTimeout(500)
    const restoredTf = await ctx.page
      .locator(`.react-flow__node[data-id="${dragId}"]`)
      .first()
      .evaluate((el) => el.style.transform)
    check('Studio › Diagram: 뷰 왕복 후 드래그 위치 복원', restoredTf === draggedTf)
  }
  // ── Studio › Seed — 시드 세트 저작(선언 → 행 → 변수). CASE-studio-040~044 (docs/qa/db-studio.md) ──
  {
    await click('button:has-text("Seed")')
    await ctx.page.waitForSelector('text=아직 시드 세트가 없어요', { timeout: 8_000 })
    check('Studio › Seed: 세트 없을 때 빈 상태 CTA', (await body()).includes('테이블에서 시드 세트 만들기'))

    // 테이블 고르기 — orders 의 PK 는 AUTO_INCREMENT 라 짝짓기 기준 기본값이 비어야 한다(사람이 고름).
    await click('button:has-text("테이블에서 시드 세트 만들기")')
    await ctx.page.waitForSelector('[data-seed-candidate]', { timeout: 8_000 })
    // 뷰는 데이터를 담지 않으므로 세트 후보에서 빠진다 — 앞서 Definition 에서 만든 뷰로 실제 검증.
    check('Studio › Seed: 등록 후보에 뷰가 없다', (await ctx.page.locator('[data-seed-candidate^="new_view"]').count()) === 0)
    check('Studio › Seed: 등록 후보에 테이블은 있다', (await ctx.page.locator('[data-seed-candidate]').count()) > 0)
    await click('[data-seed-candidate="orders"]')
    await ctx.page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
    check('Studio › Seed: 세트 등록(orders)', (await ctx.page.locator('[data-seed-set-row="orders"]').count()) === 1)
    check('Studio › Seed: 자동증가 PK → 짝짓기 기준 경고', (await ctx.page.locator('[data-seed-needs-key]').count()) === 1)

    // 컬럼 역할 토글 1개로 짝짓기 기준 지정 → 경고 해제. 기본은 '포함'이라 한 번 누르면 '무시', 두 번이면 '짝짓기'.
    check(
      'Studio › Seed: 컬럼 역할 토글은 컬럼당 1개',
      (await ctx.page.locator('[data-seed-role-toggle="order_number"]').count()) === 1
    )
    check(
      'Studio › Seed: 컬럼 기본 역할은 포함',
      (await ctx.page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="include"]').count()) === 1
    )
    await click('[data-seed-role-toggle="order_number"]')
    await ctx.page.waitForTimeout(200)
    check(
      'Studio › Seed: 역할 순환 포함 → 무시',
      (await ctx.page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="ignore"]').count()) === 1
    )
    await click('[data-seed-role-toggle="order_number"]')
    await ctx.page.waitForTimeout(300)
    check(
      'Studio › Seed: 역할 순환 무시 → 짝짓기',
      (await ctx.page.locator('[data-seed-role-toggle="order_number"][data-seed-col-role="key"]').count()) === 1
    )
    check('Studio › Seed: 짝짓기 기준 지정 → 경고 해제', (await ctx.page.locator('[data-seed-needs-key]').count()) === 0)

    // DB 가 값을 만드는 컬럼(orders.id = AUTO_INCREMENT)은 짝짓기 기준으로 갈 수 없다 — 역할 순환이 건너뛴다.
    {
      for (let i = 0; i < 3; i++) {
        await click('[data-seed-role-toggle="id"]')
        await ctx.page.waitForTimeout(150)
      }
      check(
        'Studio › Seed: DB 생성 컬럼은 짝짓기 기준으로 갈 수 없다(역할 순환 건너뜀)',
        (await ctx.page.locator('[data-seed-role-toggle="id"][data-seed-col-role="key"]').count()) === 0
      )
      // 원복 — 이후 저장 검증이 무시 컬럼 목록을 전제로 한다(id 를 무시로 남기면 순서가 달라진다).
      while ((await ctx.page.locator('[data-seed-role-toggle="id"][data-seed-col-role="include"]').count()) === 0) {
        await click('[data-seed-role-toggle="id"]')
        await ctx.page.waitForTimeout(150)
      }
    }

    // 짝짓기 기준을 UNIQUE 가 뒷받침하는지 안내 — order_number 엔 UK 가 있어 조용하고,
    // UNIQUE 없는 구성(order_number+status)으로 바꾸면 반영 단계 함의를 알린다.
    check(
      'Studio › Seed: UNIQUE 가 뒷받침하는 짝짓기 기준엔 안내 없음',
      (await ctx.page.locator('[data-seed-key-unbacked]').count()) === 0
    )
    const cycleTo = async (column, role) => {
      for (let i = 0; i < 3; i++) {
        if ((await ctx.page.locator(`[data-seed-role-toggle="${column}"][data-seed-col-role="${role}"]`).count()) === 1) return
        await click(`[data-seed-role-toggle="${column}"]`)
        await ctx.page.waitForTimeout(200)
      }
    }
    await cycleTo('status', 'key')
    check(
      'Studio › Seed: UNIQUE 없는 짝짓기 기준 구성 → UPSERT 불가 안내',
      (await ctx.page.locator('[data-seed-key-unbacked]').count()) === 1
    )
    await cycleTo('status', 'include') // 원복

    // 무시 컬럼 지정(비교 소음 제거)
    await cycleTo('ordered_at', 'ignore')
    check(
      'Studio › Seed: 무시 컬럼 지정 표시',
      (await ctx.page.locator('[data-seed-role-toggle="ordered_at"][data-seed-col-role="ignore"]').count()) === 1
    )

    // 무시 컬럼 감추기 토글 — 표에서만 빠진다(선언은 그대로). 끝에 반드시 원복해야
    // 이후 흐름(컬럼 이름으로 셀 찍기)이 감춰진 컬럼을 못 찾는 일이 없다.
    {
      const colsShown = await ctx.page.locator('[data-seed-col]').count()
      check('Studio › Seed: 무시 컬럼이 있으면 감추기 버튼이 나온다',
        (await ctx.page.locator('[data-seed-hide-ignored="false"]').count()) === 1)
      await click('[data-seed-hide-ignored]')
      await ctx.page.waitForTimeout(200)
      check(
        'Studio › Seed: 감추기 → 무시 컬럼이 표에서 빠진다',
        (await ctx.page.locator('[data-seed-col="ordered_at"]').count()) === 0 &&
          (await ctx.page.locator('[data-seed-col]').count()) === colsShown - 1
      )
      // 선언 바는 이름을 늘어놓지 않고 **개수만** 보인다(UI 소음) — 이름은 설명(title)에 남는다.
      // 확인할 것은 "표에서 감춰도 선언은 안 바뀐다"이므로 개수와 설명으로 가른다.
      const ignoredChip = ctx.page.locator('[data-seed-ignored-count]')
      check(
        'Studio › Seed: 감춰도 선언은 그대로(무시 개수 유지 · 이름은 설명에 남는다)',
        (await ignoredChip.getAttribute('data-seed-ignored-count')) === '1' &&
          ((await ignoredChip.getAttribute('title')) ?? '').includes('ordered_at')
      )
      await click('[data-seed-hide-ignored]')
      await ctx.page.waitForTimeout(200)
      check(
        'Studio › Seed: 다시 보이기 → 컬럼 수 원복',
        (await ctx.page.locator('[data-seed-col]').count()) === colsShown &&
          (await ctx.page.locator('[data-seed-hide-ignored="false"]').count()) === 1
      )
    }

    // 행 추가 + 셀 입력
    const fill = async (rowIdx, column, value) => {
      const cell = ctx.page.locator('[data-seed-row]').nth(rowIdx).locator(`[data-seed-cell="${column}"]`)
      await cell.click()
      await ctx.page.waitForTimeout(150)
      // 기존 값이 있으면 지우고 쓴다 — 안 지우면 입력이 덧붙어 값이 뒤섞인다.
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.type(value)
      await ctx.page.keyboard.press('Enter')
      await ctx.page.waitForTimeout(200)
    }
    await click('button:has-text("행 추가")')
    await ctx.page.waitForSelector('[data-seed-row]', { timeout: 5_000 })
    await fill(0, 'order_number', 'SEED-0001')
    check('Studio › Seed: 셀 입력 반영', (await body()).includes('SEED-0001'))

    // 중복 짝짓기 기준 값 → 두 행 모두 오류 표시
    await click('button:has-text("행 추가")')
    await ctx.page.waitForTimeout(200)
    await fill(1, 'order_number', 'SEED-0001')
    check('Studio › Seed: 중복 짝짓기 기준 → 두 행 오류 표시',
      (await ctx.page.locator('[data-seed-row-issue="duplicate-key"]').count()) === 2)

    // 값을 바꿔 중복 해소 → 오류 사라짐
    await fill(1, 'order_number', 'SEED-0002')
    check('Studio › Seed: 중복 해소 → 오류 없음', (await ctx.page.locator('[data-seed-row-issue]').count()) === 0)

    // 컬럼 머리에 제약이 보인다 — Definition 화면과 왕복하지 않게(grid AC-7)
    check('Studio › Seed: 컬럼 머리 PK 배지', (await ctx.page.locator('[data-seed-col-badge="PK"]').count()) === 1)
    check('Studio › Seed: 필수 컬럼 배지', (await ctx.page.locator('[data-seed-col-required]').count()) >= 1)

    // 필수인데 빈 셀 → 행 표시, 채우면 해제(grid AC-8). orders 는 user_id 가 NOT NULL·기본값 없음.
    const missingBefore = await ctx.page.locator('[data-seed-row-missing]').count()
    check('Studio › Seed: 필수 값 빈 행 표시', missingBefore === 2)
    await fill(0, 'user_id', '1001')
    check(
      'Studio › Seed: 필수 값 채우면 표시 해제',
      (await ctx.page.locator('[data-seed-row-missing]').count()) === missingBefore - 1
    )

    // ── 별칭 + 시드 행끼리의 참조 (CASE-studio-042c) ──
    {
      // 별칭 칸은 **이름 훅**으로 찍는다 — 위치(`td` nth)로 찍으면 앞에 칸이 하나 늘어날 때
      // 엉뚱한 칸(행 삭제)을 눌러 행이 지워진다(실제로 그렇게 깨졌다).
      const setAlias = async (rowIdx, v) => {
        await ctx.page.locator('[data-seed-alias-cell]').nth(rowIdx).click()
        await ctx.page.waitForTimeout(150)
        await ctx.page.keyboard.type(v)
        await ctx.page.keyboard.press('Enter')
        await ctx.page.waitForTimeout(200)
      }
      await setAlias(0, 'first-order')
      check('Studio › Seed: 별칭 저장', (await ctx.page.locator('[data-seed-row-alias="first-order"]').count()) === 1)

      // 겹치는 별칭 → 양쪽 다 오류
      await setAlias(1, 'first-order')
      check(
        'Studio › Seed: 겹치는 별칭 → 두 행 오류',
        (await ctx.page.locator('[data-seed-row-alias-issue="duplicate-alias"]').count()) === 2
      )
      await setAlias(1, 'second-order')
      check('Studio › Seed: 별칭 중복 해소', (await ctx.page.locator('[data-seed-row-alias-issue]').count()) === 0)

      // user_id 는 users 를 가리키는 FK — orders 를 가리키면 관계 불일치로 잡힌다
      await fill(1, 'user_id', '@orders#first-order')
      check('Studio › Seed: 참조 셀 표식', (await ctx.page.locator('[data-seed-ref-cell]').count()) === 1)
      check(
        'Studio › Seed: FK 가 가리키는 테이블과 다른 참조 → 오류',
        (await ctx.page.locator('[data-seed-row-ref-issue="true"]').count()) === 1
      )

      // 깨진 참조(없는 별칭)도 오류 — users 세트가 없으니 unknown-table 로 잡힌다
      await fill(1, 'user_id', '@users#ghost')
      check(
        'Studio › Seed: 세트 없는 테이블 참조 → 오류 유지',
        (await ctx.page.locator('[data-seed-row-ref-issue="true"]').count()) === 1
      )
      // 원복 — 이후 흐름(저장 검증)은 평범한 값을 전제
      await fill(1, 'user_id', '2002')
      check('Studio › Seed: 참조 지우면 오류 해제', (await ctx.page.locator('[data-seed-row-ref-issue]').count()) === 0)
    }

    // 행 삭제 버튼 — 호버 없이 항상 보여야 한다(Console › Data 와 같은 문법).
    // (회귀: opacity-0 + group-hover 라 표 오른쪽 끝의 빈 컬럼으로만 보였고 발견할 방법이 없었다.)
    check(
      'Studio › Seed: 행 삭제 버튼이 호버 없이 보인다',
      await ctx.page.locator('[data-seed-row-delete]').first().isVisible()
    )
    // 머리와 본문의 칸 수가 같아야 한다 — 칸을 하나 끼워 넣을 때 한쪽만 고치면 표 전체가
    // 한 칸씩 밀린다(실제로 그렇게 깨졌고 "보인다" 검사만으로는 안 잡혔다).
    check(
      'Studio › Seed: 표 머리와 본문 칸 수 일치(열 밀림 방지)',
      (await ctx.page.locator('thead tr th').count()) ===
        (await ctx.page.locator('[data-seed-row]').first().locator('td').count())
    )

    // 변수 자리표시자 — 환경마다 다른 값은 값 대신 변수로
    await fill(0, 'memo', '{{ADMIN_PASSWORD_HASH}}')
    check('Studio › Seed: 변수 셀 표식', (await ctx.page.locator('[data-seed-variable-cell]').count()) === 1)
    check('Studio › Seed: 세트가 요구하는 변수 목록',
      (await ctx.page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

    // PK 생성 규칙 — 자유 입력이 아니라 **고르기**다. 목록은 PK 컬럼 타입으로 걸러진다.
    // orders.id 는 BIGINT 자동증가라 문자열 규칙이 목록에 아예 없어야 한다(사고를 목록에서 없앤다).
    check('Studio › Seed: PK 가 DB 담당이면 규칙 줄이 없다', (await ctx.page.locator('[data-seed-pk-rule]').count()) === 0)
    await click('[data-seed-pk-strategy="seed"]')
    await ctx.page.waitForSelector('[data-seed-pk-rule]', { timeout: 5_000 })
    check(
      'Studio › Seed: 규칙이 비면 미리보기가 셀 값 없음을 알린다',
      (await ctx.page.locator('[data-seed-pk-preview-from="none"]').count()) === 1
    )
    await click('[data-seed-pk-rule]')
    await ctx.page.waitForSelector('[data-seed-pk-rule-option]', { timeout: 5_000 })
    // 숫자 PK → `셀에 직접 쓴 값` + `직접 입력…` 둘뿐. {uuid}·{key} 는 고를 수 없다.
    check(
      'Studio › Seed: 숫자 PK 는 문자열 규칙을 목록에 안 내놓는다',
      (await ctx.page.locator('[data-seed-pk-rule-option]').count()) === 2 &&
        (await ctx.page.locator('[data-seed-pk-rule-option="{uuid}"]').count()) === 0
    )
    // `직접 입력…` 으로 가면 자유 입력칸 + 조각 칩이 열린다(접두사가 필요한 드문 경우).
    await click('[data-seed-pk-rule-option="__custom__"]')
    await ctx.page.waitForSelector('[data-seed-pk-template]', { timeout: 5_000 })
    check('Studio › Seed: 직접 입력 → 조각 칩 4개 노출', (await ctx.page.locator('[data-seed-pk-token]').count()) === 4)
    await click('[data-seed-pk-token="{table}"]')
    await ctx.page.waitForTimeout(200)
    await click('[data-seed-pk-token="{alias}"]')
    await ctx.page.waitForTimeout(250)
    check(
      'Studio › Seed: 칩이 규칙 끝에 붙는다',
      (await ctx.page.locator('[data-seed-pk-template]').inputValue()) === '{table}{alias}'
    )
    check(
      'Studio › Seed: 미리보기가 규칙 결과를 보인다',
      (await ctx.page.locator('[data-seed-pk-preview-from="template"]').count()) === 1
    )
    // 직접 입력 경로에만 남는 사고들 — 오타 · 타입 불일치 · 상수 규칙(전 행 같은 PK).
    await ctx.page.locator('[data-seed-pk-template]').fill('{uuidd}')
    await ctx.page.waitForTimeout(250)
    check('Studio › Seed: 모르는 자리표시자 경고', (await ctx.page.locator('[data-seed-pk-unknown]').count()) === 1)
    await ctx.page.locator('[data-seed-pk-template]').fill('{uuid}')
    await ctx.page.waitForTimeout(250)
    check('Studio › Seed: 숫자 PK 에 UUID → 타입 경고', (await ctx.page.locator('[data-seed-pk-type-issue]').count()) === 1)
    await ctx.page.locator('[data-seed-pk-template]').fill('fixed-1')
    await ctx.page.waitForTimeout(250)
    check('Studio › Seed: 상수 규칙 → 전 행 같은 PK 경고', (await ctx.page.locator('[data-seed-pk-constant]').count()) === 1)
    await ctx.page.locator('[data-seed-pk-template]').fill('u-{alias}')
    await ctx.page.waitForTimeout(250)
    check(
      'Studio › Seed: 행마다 달라지는 규칙이면 경고 해제',
      (await ctx.page.locator('[data-seed-pk-constant]').count()) === 0
    )
    // 원복 — 이후 버전 컷·Diff 검증이 보는 세트 상태를 바꾸지 않는다.
    await ctx.page.locator('[data-seed-pk-template]').fill('')
    await ctx.page.waitForTimeout(200)
    await click('[data-seed-pk-strategy="db"]')
    await ctx.page.waitForTimeout(200)
    check('Studio › Seed: DB 담당으로 되돌리면 규칙 줄이 사라진다', (await ctx.page.locator('[data-seed-pk-rule]').count()) === 0)

    // '설계에 없는 행 = 삭제 후보' 선택 → 경고 문구
    await click('[data-seed-strength="authoritative"]')
    await ctx.page.waitForTimeout(200)
    check('Studio › Seed: 삭제 후보 선택 시 경고 문구', (await body()).includes('삭제 후보'))

    // 저장(설계 스코프) — 디바운스 후 저장소에 남는다
    await ctx.page.waitForTimeout(600)
    const saved = await ctx.page.evaluate(async () => {
      const list = await window.rockury.seedSets.list()
      const s = list.find((x) => x.designId === 'commerce-core' && x.tableName === 'orders')
      return s ? { key: s.naturalKey, ignored: s.ignoredColumns, strength: s.strength, rows: s.rows.length } : null
    })
    check('Studio › Seed: 선언·행이 설계 스코프로 저장',
      saved?.key?.[0] === 'order_number' && saved?.ignored?.[0] === 'ordered_at' &&
      saved?.strength === 'authoritative' && saved?.rows === 2)
  }

  // Definition 으로 복귀(이후 흐름 원복)
  await click('button:has-text("Definition")')
  await ctx.page.waitForTimeout(200)

  // Versions › Timeline — 시드 버전
  await click('button:has-text("Versions")')
  await ctx.page.waitForSelector('text=버전 타임라인', { timeout: 5_000 })
  await ctx.page.waitForTimeout(300)
  const tl = await body()
  check('Timeline: 시드 버전 v0.3.14 표시', tl.includes('v0.3.14'))

  // 버전 컷 (Patch → v0.3.15)
  await click('button:has-text("버전 컷")')
  await ctx.page.waitForSelector('text=증가 유형', { timeout: 5_000 })
  await click('button[aria-pressed]:has-text("Patch")')
  await click('button[type="submit"]')
  await ctx.page.waitForTimeout(500)
  check('버전 컷 후 v0.3.15 등장', (await body()).includes('v0.3.15'))
  check('버전 컷: 시드 행 수 표시(스냅샷에 시드 동봉)', (await ctx.page.locator('[data-version-seed-rows]').count()) >= 1)

  // ⭐ Version Diff 에 시드 섹션 — 시드 없던 옛 버전(v0.3.14)↔시드 담긴 새 버전(v0.3.15).
  //    CASE-studio-045: 옛 스냅샷 폴백이 깨지지 않고 시드 델타가 보인다.
  await click('button:has-text("Version Diff")')
  await ctx.page.waitForSelector('text=버전 비교', { timeout: 8_000 })
  await ctx.page.waitForTimeout(400)
  check('Version Diff: 시드 섹션 렌더', (await ctx.page.locator('[data-seed-diff]').count()) === 1)
  check('Version Diff: 시드 세트(orders) 델타 표시', (await ctx.page.locator('[data-seed-diff-set="orders"]').count()) === 1)
  await click('button:has-text("Timeline")')
  await ctx.page.waitForTimeout(300)

  // ── MCP 쓰기 도구(2단계) — 에이전트 쓰기가 열린 화면에 즉시 반영(리하이드레이션) ──
  // CASE-ai-072/073 (docs/qa/ai-server.md). 토큰은 위 재발급 이후 값을 새로 조회.
  {
    const st = await ctx.page.evaluate(() => window.rockury.ai.status())
    const wHdrs = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${st.token}`
    }
    const wPost = (bodyObj, sid) =>
      fetch(st.url, {
        method: 'POST',
        headers: { ...wHdrs, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const wInit = await wPost({
      jsonrpc: '2.0', id: 41, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-write', version: '0' } }
    })
    const wSid = wInit.headers.get('mcp-session-id')
    await wPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, wSid)
    const callTool = async (name, args, id) =>
      (await (await wPost({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, wSid)).json())
        .result

    const wNames = (await (await wPost({ jsonrpc: '2.0', id: 42, method: 'tools/list' }, wSid)).json())
      .result.tools.map((t) => t.name)
    check('MCP 쓰기: tools/list 쓰기 5종 노출', ['create_design', 'update_design', 'set_schema', 'patch_schema', 'create_version'].every((n) => wNames.includes(n)))
    check('MCP 쓰기: 삭제류 도구 부재', wNames.every((n) => !/delete|remove|drop/.test(n)))

    // create_version(번호 생략 → 최신 v0.3.15 에서 patch 증가) — Versions 타임라인이 열린 채 호출.
    const cut = await callTool('create_version', { designId: 'commerce-core', note: '에이전트 컷' }, 43)
    check('MCP 쓰기: create_version 성공(v0.3.16)', cut?.isError !== true && cut?.content?.[0]?.text?.includes('v0.3.16') === true)
    await ctx.page.waitForSelector('text=v0.3.16', { timeout: 5_000 })
    check('MCP 쓰기: 타임라인 즉시 반영(v0.3.16 — 수동 재조회 없음)', (await body()).includes('v0.3.16'))

    // set_schema — Studio Definition 이 열린 채 get_schema 왕복으로 테이블 추가 → 즉시 반영.
    await click('button:has-text("Studio")')
    await click('button:has-text("Definition")')
    await ctx.page.waitForSelector('text=orders', { timeout: 5_000 })
    const gs = JSON.parse((await callTool('get_schema', { designId: 'commerce-core' }, 44)).content[0].text)
    const setRes = await callTool(
      'set_schema',
      {
        designId: 'commerce-core',
        tables: [
          ...gs.tables,
          { name: 'mcp_probe', comment: '에이전트 추가', columns: [{ name: 'id', type: 'int', nullable: false }] }
        ]
      },
      45
    )
    check('MCP 쓰기: set_schema 성공', setRes?.isError !== true)
    await ctx.page.waitForSelector('text=mcp_probe', { timeout: 5_000 })
    check('MCP 쓰기: Studio Definition 즉시 반영(mcp_probe)', (await body()).includes('mcp_probe'))

    // 쓰기 오류 규율 — 미상 설계는 프로토콜 오류가 아닌 isError + 해결 안내.
    const bad = await callTool('set_schema', { designId: 'no-such', tables: [] }, 46)
    check('MCP 쓰기: 미상 설계 isError + list_designs 안내', bad?.isError === true && bad?.content?.[0]?.text?.includes('list_designs') === true)

    // patch_schema — 전체 재전송 없이 부분 수정, 열린 화면에 즉시 반영. (spec tools.write AC-8)
    const patched = await callTool(
      'patch_schema',
      { designId: 'commerce-core', operations: [{ op: 'rename_table', table: 'mcp_probe', newName: 'mcp_patched' }] },
      47
    )
    check('MCP 쓰기: patch_schema 부분 수정 성공', patched?.isError !== true)
    await ctx.page.waitForSelector('text=mcp_patched', { timeout: 5_000 })
    check('MCP 쓰기: patch_schema 즉시 반영(mcp_patched)', (await body()).includes('mcp_patched'))

    // 저장 전 위생 검사 — 깨진 글자는 반영 0 으로 막힌다. (spec tools.write AC-9)
    const dirty = await callTool(
      'patch_schema',
      { designId: 'commerce-core', operations: [{ op: 'set_table_comment', table: 'mcp_patched', comment: '깨\uFFFD짐' }] },
      48
    )
    check(
      'MCP 쓰기: 깨진 글자는 저장 전에 차단(경로·코드포인트 안내)',
      dirty?.isError === true && dirty?.content?.[0]?.text?.includes('U+FFFD') === true
    )

    // 방언 미지정 — 앱이 "사용자에게 물어보라"고 되돌린다(에이전트가 지어내지 못하게). (spec tools.write AC-1)
    const noDialect = await callTool('create_design', { name: 'E2E 방언 미지정' }, 49)
    check(
      'MCP 쓰기: 방언 누락 시 사용자 선택 요구(생성 안 함)',
      noDialect?.isError === true && noDialect?.content?.[0]?.text?.includes('사용자에게') === true
    )
  }

  // ── 운영부: Connection(1급) 생성 + mysql test-db 연결 테스트 (설계 불필요) ──
  await click('button:has-text("Connections")')
  await ctx.page.waitForTimeout(300)
  await click('button:has-text("새 연결")')
  await ctx.page.waitForSelector('text=연결 이름', { timeout: 5_000 })
  await ctx.page.locator('input[placeholder*="운영 DB"]').fill('E2E-mysql')
  await ctx.page.locator('input[placeholder="3306"]').fill('13306') // test-db mysql 포트 (기본 벤더 mysql)
  await ctx.page.locator('input[placeholder="testdb"]').fill('testdb')
  await ctx.page.locator('input[placeholder="test"]').fill('test')
  await ctx.page.locator('input[type="password"]').fill('test')
  await click('button:has-text("연결 테스트")')
  await ctx.page.waitForSelector('text=연결 성공', { timeout: 15_000 })
  check('Connections: mysql test-db 연결 성공(serverVersion)', (await body()).includes('연결 성공'))
  await click('button[type="submit"]:has-text("연결 만들기")')
  await ctx.page.waitForSelector('text=E2E-mysql', { timeout: 5_000 })
  check('연결 카드(E2E-mysql) 생성', (await body()).includes('E2E-mysql'))

  // ── Connection 그룹: 생성(인라인 이름) → 카드 DnD 로 그룹 넣기/빼기 → 그룹 삭제 ──
  {
    await click('button:has-text("새 그룹")')
    await ctx.page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await ctx.page.locator('input[data-group-rename]').fill('E2E-그룹')
    await ctx.page.keyboard.press('Enter')
    await ctx.page.waitForSelector('text=E2E-그룹', { timeout: 5_000 })
    check('Connections: 그룹 생성 + 인라인 이름 변경(E2E-그룹)', (await body()).includes('E2E-그룹'))

    // 카드를 그룹 영역으로 드래그 → group_id 영속 (포인터 DnD: 고스트·플레이스홀더 경로)
    const dragCardTo = async (zoneSel) => {
      const cbox = await ctx.page.locator('[data-conn-id]').first().boundingBox()
      const zbox = await ctx.page.locator(zoneSel).first().boundingBox()
      await ctx.page.mouse.move(cbox.x + cbox.width / 2, cbox.y + 12)
      await ctx.page.mouse.down()
      await ctx.page.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 12 })
      await ctx.page.mouse.up()
      await ctx.page.waitForTimeout(500) // move IPC 영속 대기
    }
    await dragCardTo('section[data-conn-group]:not([data-conn-group=""])')
    const groupedId = await ctx.page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 → 그룹 소속 저장(groupId)', !!groupedId)

    // 그룹에서 미분류 영역으로 드래그 아웃 → group_id 해제
    await dragCardTo('section[data-conn-group=""]')
    const ungroupedId = await ctx.page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 아웃 → 미분류 복귀(groupId null)', ungroupedId === null)

    // 두 번째 그룹을 만들고 그립 핸들 드래그로 순서 뒤집기 → 영속
    await click('button:has-text("새 그룹")')
    await ctx.page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await ctx.page.locator('input[data-group-rename]').fill('E2E-그룹2')
    await ctx.page.keyboard.press('Enter')
    await ctx.page.waitForTimeout(300)
    const orderBefore = await ctx.page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    // 두 번째 그룹 핸들을 첫 그룹 위로 끌어올린다
    {
      const handles = ctx.page.locator('button[data-group-handle]')
      const h2 = await handles.nth(1).boundingBox()
      const s1 = await ctx.page.locator('section[data-conn-group]:not([data-conn-group=""])').first().boundingBox()
      await ctx.page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2)
      await ctx.page.mouse.down()
      await ctx.page.mouse.move(s1.x + s1.width / 2, s1.y + 4, { steps: 12 })
      await ctx.page.mouse.up()
      await ctx.page.waitForTimeout(500)
    }
    const orderAfter = await ctx.page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    check(
      'Connections: 그룹 핸들 드래그로 순서 변경(영속·역순)',
      orderBefore.length === 2 && orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]
    )
    // 만든 두 번째 그룹 정리
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await ctx.page.waitForTimeout(400)

    // 그룹 삭제(연결은 남아야 함)
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await ctx.page.waitForTimeout(400)
    const afterDelete = await ctx.page.evaluate(async () => ({
      groups: (await window.rockury.connectionGroups.list()).length,
      conns: (await window.rockury.connections.list()).length
    }))
    check('Connections: 그룹 삭제 → 그룹 0 개, 연결은 보존', afterDelete.groups === 0 && afterDelete.conns === 1)
  }

  // ── 자동확인 제외: 제외로 바꾸면 잔존 상태가 '미확인'으로 돌아오고, 새로고침이 다시 확인하지 않는다 ──
  //   (회귀: 제외 후에도 옛 '실패/연결됨'이 남아 "계속 확인되는 것처럼" 보이던 문제)
  {
    await click('button[title="편집"]')
    await ctx.page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await ctx.page.waitForSelector('text=자동확인 제외', { timeout: 5_000 })
    check('Connections: 자동확인 제외 배지 표시', (await body()).includes('자동확인 제외'))
    await click('button:has-text("새로고침")')
    await ctx.page.waitForTimeout(800)
    check('Connections: 제외 연결은 새로고침 후 미확인(재확인 안 함)', (await body()).includes('미확인'))
    // 원복 — 이후 흐름은 자동확인 대상 상태를 전제
    await click('button[title="편집"]')
    await ctx.page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await ctx.page.waitForTimeout(300)
  }

  // 카드 클릭 → active Connection → Console › Object 로 실 DB 역설계(Phase 2a)
  await click('div[role="button"]:has-text("E2E-mysql")')
  await ctx.page.waitForTimeout(200)
  await click('button:has-text("Console")')
  await click('button:has-text("Object")')
  await ctx.page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const obj = await body()
  check('Console › Object: 실 DB 역설계(users/user_roles)', obj.includes('users') && obj.includes('user_roles'))

  // Console › Diagram — 같은 introspection TableDef[] 를 ERD 그래프로(Phase 2e · @xyflow+dagre).
  await click('button:has-text("Diagram")')
  await ctx.page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await ctx.page.waitForTimeout(400)
  const diag = await body()
  check(
    'Console › Diagram: ERD 노드(users/user_roles) 렌더',
    (await ctx.page.locator('.react-flow__node').count()) > 0 && diag.includes('users') && diag.includes('user_roles')
  )
  // FK 관계가 엣지로 그려진다(예: user_roles → users).
  check('Console › Diagram: 관계 엣지(react-flow__edge) 존재', (await ctx.page.locator('.react-flow__edge').count()) > 0)

  // ⭐ v2 레이아웃 영속 — 노드를 드래그하면 위치가 저장되고, 탭을 벗어났다 와도 복원된다.
  const nodeTf = async (id) =>
    ctx.page.locator(`.react-flow__node[data-id="${id}"]`).first().evaluate((el) => el.style.transform)
  {
    const nd = ctx.page.locator('.react-flow__node[data-id="t:users"]').first()
    const box = await nd.boundingBox()
    await ctx.page.mouse.move(box.x + box.width / 2, box.y + 8)
    await ctx.page.mouse.down()
    await ctx.page.mouse.move(box.x + box.width / 2 + 160, box.y + 8 + 110, { steps: 10 })
    await ctx.page.mouse.up()
    await ctx.page.waitForTimeout(500) // onNodeDragStop → saveLayout(IPC)
    const dragged = await nodeTf('t:users')
    const savedCount = await ctx.page.evaluate(async () => {
      const cid = (await window.rockury.connections.list())[0].id
      const l = await window.rockury.diagram.getLayout(cid)
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Console › Diagram: 드래그 → 레이아웃 저장(getLayout 비어있지 않음)', savedCount > 0)
    // Object 탭으로 나갔다가 Diagram 으로 복귀 → 저장된 위치로 복원(dagre 기본이 아님)
    await click('button:has-text("Object")')
    await ctx.page.waitForTimeout(300)
    await click('button:has-text("Diagram")')
    await ctx.page.waitForSelector('.react-flow__node[data-id="t:users"]', { timeout: 15_000 })
    await ctx.page.waitForTimeout(400)
    const restored = await nodeTf('t:users')
    check('Console › Diagram: 탭 왕복 후 드래그 위치 복원', restored === dragged)
  }

  // 검색 — 매칭 테이블만 강조(data-erd-match). 'user' → users/user_roles 매칭.
  await ctx.page.locator('input[placeholder="테이블/컬럼 검색"]').fill('user')
  await ctx.page.waitForTimeout(300)
  check('Console › Diagram: 검색 매칭 강조', (await ctx.page.locator('[data-erd-match="true"]').count()) > 0)
  await ctx.page.locator('input[placeholder="테이블/컬럼 검색"]').fill('')
  await ctx.page.waitForTimeout(200)
  check('Console › Diagram: 검색 지우면 강조 해제', (await ctx.page.locator('[data-erd-match="true"]').count()) === 0)

  // 간략 토글 — 컬럼 접힘(data-erd-compact).
  await click('button:has-text("간략")')
  await ctx.page.waitForTimeout(200)
  check('Console › Diagram: 간략 토글 → 컬럼 접힘', (await ctx.page.locator('[data-erd-compact="true"]').count()) > 0)
  await click('button:has-text("간략")') // 원복
  await ctx.page.waitForTimeout(150)

  // 좌측 테이블 목록 패널 — Data 사이드바와 같은 구성. 항목을 누르면 그 테이블로 캔버스가 이동한다.
  {
    const panel = ctx.page.locator('[data-diagram-table-panel]')
    check('Console › Diagram: 좌측 테이블 목록 패널 존재', (await panel.count()) > 0)
    const viewport = ctx.page.locator('.react-flow__viewport').first()
    const before = await viewport.getAttribute('style')
    await panel.locator('[data-table-row="user_roles"]').first().click()
    await ctx.page.waitForTimeout(900) // fitView 애니메이션(400ms) 여유
    const after = await viewport.getAttribute('style')
    check('Console › Diagram: 목록 클릭 → 해당 테이블로 캔버스 이동(포커싱)', before !== after)
  }

  // 내보내기 — PNG 클릭 → html-to-image 캡처 성공(toolbar data-export-status=ok).
  // (Electron 에선 data-URL 다운로드 이벤트가 Playwright 로 안 잡혀, 캡처 성공 여부를 상태로 검증.)
  await ctx.page.locator('.react-flow__panel button:has-text("PNG")').first().click()
  await ctx.page.waitForSelector('[data-export-status="ok"]', { timeout: 15_000 })
  check('Console › Diagram: PNG 내보내기(html-to-image 캡처 성공)', (await ctx.page.locator('[data-export-status="ok"]').count()) > 0)

  // Console › Diagram 편집 — 편집 진입 → 노드 선택 시 편집 패널 → 캔버스 + 로 테이블 추가(노드 증가·대기 변경) → 버리기.
  // (적용 파이프라인은 Definition 에서 실 DB 왕복으로 검증됨 — 여기선 다이어그램 편집 UI 만 확인, DB 무변경.)
  await click('button:text-is("편집")')
  await ctx.page.waitForSelector('.react-flow__node', { timeout: 10_000 })
  await ctx.page.waitForTimeout(300)
  const editNodes0 = await ctx.page.locator('.react-flow__node').count()
  await ctx.page.locator('.react-flow__node').first().click()
  await ctx.page.waitForTimeout(300)
  check('Console › Diagram 편집: 노드 선택 → 편집 패널(관계(FK))', (await body()).includes('관계(FK)'))
  await ctx.page.locator('.react-flow__panel button:has-text("테이블")').first().click()
  await ctx.page.waitForTimeout(400)
  check('Console › Diagram 편집: 캔버스 + → 노드 증가 + 대기 변경', (await ctx.page.locator('.react-flow__node').count()) > editNodes0 && (await body()).includes('대기 변경'))
  await click('button:has-text("버리기")')
  await ctx.page.waitForSelector('button:text-is("편집")', { timeout: 10_000 })
  check('Console › Diagram 편집: 버리기 → 읽기 모드 복귀', (await ctx.page.locator('button:text-is("편집")').count()) > 0)

  // Console › Definition — 같은 introspection TableDef[] 를 Studio Definition 형태(목록 | 상세/DDL)로.
  await click('button:has-text("Definition")')
  await ctx.page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const defBody = await body()
  check(
    'Console › Definition: 사이드바 실 DB 테이블 목록(users/user_roles)',
    defBody.includes('users') && defBody.includes('user_roles')
  )
  // 목록은 테이블과 뷰(view)를 갈라 보인다 — 테스트 DB 의 v_user_summary 가 뷰 묶음에 들어간다.
  check(
    'Console › Definition: 목록이 테이블/뷰를 가른다(v_user_summary 는 뷰)',
    (await ctx.page.locator('[data-table-row="v_user_summary"]').count()) > 0 && defBody.includes('뷰')
  )

  // 사이드바에서 테이블 선택 → SQL(DDL) 뷰 토글 → 실 introspection + generateDdl 로 CREATE 문 렌더.
  // NOTE: 토글은 :text-is 로 정확 일치 — has-text 는 ContextBar 의 "MySQL" 버튼까지 잡는다.
  await ctx.page.locator('[data-table-row="user_roles"]').first().click()
  await ctx.page.waitForTimeout(200)

  // FK 정책은 ON DELETE·ON UPDATE 를 **둘 다** 보인다(실 DB 는 두 값을 다 주는데 전엔 삭제 쪽만 그렸다).
  {
    const fkBody = await body()
    check(
      'Console › Definition: FK 정책 ON DELETE·ON UPDATE 동시 표기',
      fkBody.includes('ON DELETE CASCADE') && fkBody.includes('ON UPDATE CASCADE')
    )
  }
  await click('button:text-is("SQL")')
  await ctx.page.waitForSelector('text=CREATE TABLE', { timeout: 10_000 })
  const ddlBody = await body()
  check(
    'Console › Definition: SQL 뷰 DDL(CREATE TABLE user_roles) 렌더',
    ddlBody.includes('CREATE TABLE') && ddlBody.includes('user_roles')
  )
  await click('button:text-is("Table")') // Table 폼으로 복귀
  await ctx.page.waitForTimeout(150)

  // Console › Definition 편집 — 라이브 스키마 편집: 대기 변경 → DDL 미리보기 → tx 게이트 적용 → 재역설계.
  // 공유 테스트 DB 를 오염시키지 않도록 rky_probe 를 만들었다 되지운다(생성/삭제 왕복 = 클린).
  await click('button:text-is("편집")')
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('button[aria-label="테이블 추가"]').first().click()
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('input[placeholder="테이블명"]').fill('rky_probe')
  await ctx.page.locator('button:has-text("컬럼 추가")').first().click()
  await ctx.page.waitForTimeout(150)
  await ctx.page.locator('input[placeholder="컬럼명"]').last().fill('note')
  await ctx.page.waitForTimeout(150)
  check('Console › Definition 편집: 대기 변경 미리보기', (await body()).includes('대기 변경'))
  await click('button:text-is("적용")')
  await ctx.page.waitForSelector('button:text-is("편집")', { timeout: 15_000 }) // 편집 종료 = 적용 완료
  await ctx.page.waitForTimeout(500)
  check('Console › Definition 편집: 생성 적용 → 재역설계에 rky_probe 반영', (await body()).includes('rky_probe'))

  // 파괴적 편집(테이블 삭제) — 경고 후 적용, DB 를 원상 복구(rky_probe 제거).
  await click('button:text-is("편집")')
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('[data-table-row="rky_probe"]').first().click()
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('button[aria-label="테이블 메뉴"]').first().click()
  await ctx.page.waitForTimeout(150)
  await click('[role="menuitem"]:has-text("테이블 삭제")')
  await ctx.page.waitForTimeout(200)
  check('Console › Definition 편집: 삭제는 파괴적 경고 표시', (await body()).includes('파괴적'))
  await click('button:text-is("적용")') // window.confirm 은 acceptDialogs 로 자동 수락
  await ctx.page.waitForSelector('button:text-is("편집")', { timeout: 15_000 })
  await ctx.page.waitForTimeout(500)
  check('Console › Definition 편집: 삭제 적용 → rky_probe 사라짐(DB 원복)', !(await body()).includes('rky_probe'))

  // Console › Query — 저장쿼리 객체 트리 + 편집기(재설계). 새 쿼리 생성 → SELECT 실행.
  await click('button:has-text("Query")')
  await ctx.page.waitForSelector('.cm-content', { timeout: 15_000 })
  await click('button[title="새 쿼리"]')
  await ctx.page.waitForTimeout(400)
  // 구조 편집 통합: Query 트리 행에도 호버 편집(연필)/삭제 아이콘이 있어야 한다(Collection 과 동일).
  {
    const qrow = ctx.page.locator('div.group\\/row:has-text("Untitled Query")').first()
    check('Console › Query: 트리 행 이름변경(연필)+삭제 아이콘', (await qrow.locator('button[title="이름 변경"]').count()) > 0 && (await qrow.locator('button[title="삭제"]').count()) > 0)
  }
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await click('button:has-text("Run")')
  await ctx.page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Console › Query: SELECT 결과 그리드', (await body()).includes('email'))
  await ctx.page.waitForTimeout(1200) // 자동저장(라이브러리 쿼리에 SQL 반영)

  // EXPLAIN — 실행 계획(실제 반영 없음)
  await click('button[title="실행 계획(EXPLAIN)"]')
  await ctx.page.waitForSelector('text=실행 계획', { timeout: 15_000 })
  check('Console › Query: EXPLAIN 실행 계획', (await body()).includes('실행 계획'))

  // 스키마 사이드 패널(기본 열림) — 테이블/컬럼 트리 (T12)
  check('Console › Query: 스키마 패널(user_roles)', (await body()).includes('user_roles'))

  // 파라미터화 쿼리 — {{키워드}} 입력 시 파라미터 바 노출 (T11)
  await typeSql('SELECT * FROM users WHERE id = {{uid}}')
  await ctx.page.waitForTimeout(300)
  check('Console › Query: {{키워드}} 파라미터 바', (await body()).includes('파라미터'))

  // ⭐ 파괴적 트랜잭션 게이트 — WHERE 없는 UPDATE → 커밋 대기 바 → 롤백
  await typeSql('UPDATE users SET is_active = is_active')
  await click('button:has-text("Run")')
  await ctx.page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Query: DML 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await ctx.page.waitForTimeout(300)
  check('Console › Query: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 저장쿼리 SQL 을 깨끗한 SELECT 로 복원(자동저장) — Collection 참조 실행용
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await ctx.page.waitForTimeout(1200)

  // Console › Data — 조회 + 편집(수정→트랜잭션 게이트→롤백)(Phase 2b)
  await click('button:has-text("Data")')
  await ctx.page.waitForSelector('aside button:has-text("users")', { timeout: 15_000 })
  await click('aside button:has-text("users")')
  await ctx.page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Console › Data: users 행 조회', (await body()).includes('email'))

  // 컬럼 정렬(ORDER BY — 파라미터 바인드 SELECT 재조회)
  await click('th button:has-text("email")')
  await ctx.page.waitForTimeout(500)
  check('Console › Data: 컬럼 정렬 재조회', (await body()).includes('email'))

  // ⭐ 툴바 드롭다운(타임존)은 바깥 클릭/Esc 로 닫힌다 (사용자 회귀: 다른 곳 눌러도 안 닫힘)
  await click('button[title^="날짜 표시"]')
  await ctx.page.waitForSelector('text="LOCAL"', { timeout: 5_000 })
  check('Console › Data: 타임존 드롭다운 열림', (await ctx.page.locator('text="LOCAL"').count()) > 0)
  await ctx.page.keyboard.press('Escape')
  await ctx.page.waitForTimeout(200)
  check('Console › Data: 타임존 드롭다운 Esc 로 닫힘', (await ctx.page.locator('text="LOCAL"').count()) === 0)

  // 첫 행 first_name(2번째 입력) 수정 → 저장 → 게이트 → 롤백
  await ctx.page.locator('tbody tr').first().locator('input').nth(1).fill('E2E-edit')
  await ctx.page.waitForSelector('button:has-text("저장")', { timeout: 5_000 })
  await click('button:has-text("저장")')
  await ctx.page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Data: 편집 트랜잭션 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await ctx.page.waitForTimeout(300)
  check('Console › Data: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 키 배지(PK/FK/UK 텍스트) + 타입 라벨(char/varchar) (T1)
  check('Console › Data: 키 배지(PK)+타입 라벨', (await body()).includes('PK'))
  // Constraints 탭 — 전역 제약 목록(읽기 전용) (T10)
  await click('button:has-text("Constraints")')
  await ctx.page.waitForTimeout(500)
  check('Console › Data: Constraints 탭 제약 목록(PRIMARY)', (await body()).includes('PRIMARY'))
  await click('button:has-text("Tables")')
  await ctx.page.waitForTimeout(200)

  // JSON 값 — 셀은 구조 요약 칩(`{} n`)으로 보이고, 눌러 열면 정렬된 뷰어가 형식 정상 여부까지 알려 준다.
  await click('aside button:has-text("user_profiles")')
  await ctx.page.waitForSelector('tbody tr', { timeout: 15_000 })
  await ctx.page.waitForTimeout(300)
  {
    const jsonCell = ctx.page.locator('tbody button[title*="눌러서 전체 보기"]').first()
    check('Console › Data: JSON 셀이 구조 요약으로 보임', (await jsonCell.count()) > 0)
    await jsonCell.click()
    await ctx.page.waitForSelector('text=형식 정상', { timeout: 8_000 })
    const viewer = await body()
    check('Console › Data: JSON 뷰어 열림(형식 정상 표시)', viewer.includes('형식 정상'))
    check('Console › Data: JSON 뷰어가 보기 좋게 정렬해 보여줌', viewer.includes('한 줄로'))
    await click('button:text-is("취소")')
    await ctx.page.waitForTimeout(200)
  }

  // FK 참조 선택 모달 — FK 셀의 FK 버튼 클릭 → 모달(검색·페이지·Set NULL/Cancel/Apply) (사용자 보고 회귀 방지)
  await click('aside button:has-text("user_roles")')
  await ctx.page.waitForSelector('tbody tr', { timeout: 15_000 })
  await ctx.page.waitForTimeout(300)
  await click('button[title$="참조 선택"]')
  await ctx.page.waitForSelector('button:has-text("Set NULL")', { timeout: 8_000 })
  check('Console › Data: FK 참조 선택 모달 열림', (await body()).includes('참조 선택'))
  await click('button:has-text("Cancel")')
  await ctx.page.waitForTimeout(200)

  // Console › Collection — 좌 컬렉션 트리 · 중앙 아이템 · 우 QUERIES(재설계)
  await click('button:has-text("Collection")')
  await ctx.page.waitForTimeout(400)
  await click('button[title="새 컬렉션"]')
  await ctx.page.waitForTimeout(500)
  check('Console › Collection: 컬렉션 생성', (await body()).includes('Untitled Collection'))

  // 우측 QUERIES → 중앙으로 드래그앤드롭해 참조 추가(hybrid, DnD) (T15)
  await ctx.page.locator('[draggable="true"]:has-text("Untitled Query")').first().dragTo(ctx.page.locator('[data-drop="collection-items"]'))
  await ctx.page.waitForTimeout(500)
  check('Console › Collection: QUERIES 드래그 → 참조 추가(참조 배지)', (await body()).includes('참조'))

  // ⭐ Run All (조회 전용 참조 1건) → 커밋 게이트 없이 자동 종료(읽기 전용 no-commit · 사용자 회귀)
  await click('button:has-text("Run All")')
  await ctx.page.waitForSelector('text=커밋 불필요', { timeout: 15_000 })
  check('Console › Collection: 조회 전용 Run-All 은 커밋 불필요(자동 종료)', (await body()).includes('커밋 불필요') && !(await body()).includes('아직 커밋되지'))
  // ⭐ 각 쿼리 결과를 인라인으로 펼쳐 본다(눈 아이콘) — 결과 표시 방법(사용자 요청)
  await click('button[title="결과 펼치기"]')
  await ctx.page.waitForSelector('button[title="결과 접기"]', { timeout: 8_000 })
  check('Console › Collection: 각 쿼리 결과 인라인 펼침', (await ctx.page.locator('button[title="결과 접기"]').count()) > 0)

  // 쓰기 아이템 추가 → Run All → 커밋 게이트(쓰기 원자성) → 롤백
  await ctx.page.locator('input[placeholder="즉석 이름"]').fill('WRITE_ITEM')
  await ctx.page.locator('input[placeholder^="즉석 SELECT"]').fill('UPDATE users SET is_active = is_active')
  await click('button:has-text("추가")')
  await ctx.page.waitForTimeout(400)
  await click('button:has-text("Run All")')
  await ctx.page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: 쓰기 포함 Run-All 은 커밋 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await ctx.page.waitForTimeout(300)
  check('Console › Collection: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 쓰기 아이템 개별 실행 — 커밋되지 않고 트랜잭션에 쌓임(원자성 유지) → 커밋
  await ctx.page.locator('button[title^="이 아이템만 실행"]').last().click()
  await ctx.page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: 쓰기 아이템 개별 실행 → 미커밋(원자성)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("커밋")')
  await ctx.page.waitForTimeout(300)
  check('Console › Collection: 개별 실행 커밋 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // ⭐ 컬렉션 트리 DnD — 루트 아이템을 "펼친 폴더의 첫 자식" 위로 끌 때: 수직(dx=0)이면 루트
  //    유지, 오른쪽(dx>0)이면 그 폴더로 중첩. (사용자 회귀: 루트로 못 가고 폴더로만 잡히던 버그)
  const treeIds = await ctx.page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const fa = await window.rockury.collections.createFolder({ connectionId: cid, parentId: null, name: 'TREE_FOLDER' })
    await window.rockury.collections.create({ connectionId: cid, name: 'TREE_CHILD', folderId: fa.id })
    const move = await window.rockury.collections.create({ connectionId: cid, name: 'TREE_MOVE', folderId: null })
    return { cid, faId: fa.id, moveId: move.id }
  })
  const remountColl = async (waitText = 'TREE_MOVE') => { await click('button:has-text("Query")'); await click('button:has-text("Collection")'); await ctx.page.waitForSelector(`text=${waitText}`, { timeout: 8_000 }) }
  const rowHandle = async (name) => await ctx.page.locator(`div.group\\/row:has-text("${name}")`).first().locator('span').first().boundingBox()
  const rowBox = async (name) => await ctx.page.locator(`div.group\\/row:has-text("${name}")`).first().boundingBox()
  const folderOf = async (id) => ((await ctx.page.evaluate(async (cid) => await window.rockury.collections.list(cid), treeIds.cid)).find((c) => c.id === id) || {}).folderId
  // dnd-kit PointerSensor 드래그: 핸들 잡고 → 세로로 목표 행까지(가로 오프셋 dx 고정) → 놓기
  const dragTree = async (fromName, toName, dx) => {
    const from = await rowHandle(fromName), to = await rowBox(toName)
    const sx = from.x + from.width / 2, sy = from.y + from.height / 2, ty = to.y + to.height / 2
    await ctx.page.mouse.move(sx, sy); await ctx.page.mouse.down()
    await ctx.page.mouse.move(sx + dx, sy + 6, { steps: 3 }) // 활성화(activationConstraint distance:4 초과)
    await ctx.page.mouse.move(sx + dx, ty, { steps: 12 })
    await ctx.page.mouse.move(sx + dx, ty, { steps: 2 })
    await ctx.page.waitForTimeout(120); await ctx.page.mouse.up(); await ctx.page.waitForTimeout(500)
  }
  await remountColl()
  await dragTree('TREE_MOVE', 'TREE_CHILD', 0)
  check('Console › Collection: 트리 DnD 수직 드래그=루트 유지(folderId null)', (await folderOf(treeIds.moveId)) == null)
  await remountColl()
  await dragTree('TREE_MOVE', 'TREE_CHILD', 22)
  check('Console › Collection: 트리 DnD 오른쪽 드래그=폴더로 중첩(양성 대조)', (await folderOf(treeIds.moveId)) === treeIds.faId)

  // 폴더 "아이콘" 클릭으로 펼치기/접기 (사용자 회귀: 아이콘 클릭이 안 먹던 문제 — 이름만 토글됐음)
  const iconClick = async (name) => { const b = await rowHandle(name); await ctx.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await ctx.page.waitForTimeout(300) }
  const colHasRow = async (name) => (await ctx.page.locator('aside').first().locator(`button:has-text("${name}")`).count()) > 0
  const colRowNames = async () => await ctx.page.evaluate(() => [...document.querySelector('aside').querySelectorAll('div.group\\/row')].map((d) => d.querySelector('button')?.textContent.trim()))
  await remountColl()
  check('Console › Collection: 폴더 펼침 상태서 자식 보임', await colHasRow('TREE_CHILD'))
  await iconClick('TREE_FOLDER')
  check('Console › Collection: 폴더 아이콘 클릭 → 접힘(자식 숨김)', !(await colHasRow('TREE_CHILD')))
  await iconClick('TREE_FOLDER')
  check('Console › Collection: 폴더 아이콘 클릭 → 펼침(자식 복귀)', await colHasRow('TREE_CHILD'))

  // 접힌 폴더로 아이템을 넣으면 자동 펼침 → 넣은 게 사라지지 않는다 (사용자 회귀: 폴더로 들어가며 "사라짐").
  // 이름은 서로 부분문자열이 아니어야 로케이터가 안 겹친다. 트리 평탄화 순서는 churn 에 따라 달라지므로,
  // "접힌 AXFOLDER 바로 다음 행"을 런타임에 찾아 그 위로 드롭한다 — 그 행의 prev 는 정의상 AXFOLDER 라
  // 오른쪽 드래그(dx+22)면 AXFOLDER 로 중첩된다(배치와 무관하게 안정).
  const ax = await ctx.page.evaluate(async (cid) => {
    const F = await window.rockury.collections.createFolder({ connectionId: cid, parentId: null, name: 'AXFOLDER' })
    await window.rockury.collections.create({ connectionId: cid, name: 'AXCHILD', folderId: F.id })
    const drop = await window.rockury.collections.create({ connectionId: cid, name: 'AXDROP', folderId: null })
    return { fId: F.id, dropId: drop.id }
  }, treeIds.cid)
  await remountColl('AXDROP')
  await iconClick('AXFOLDER') // 접기 → AXCHILD 숨김
  check('Console › Collection: 드롭 전 접힌 상태 확인', !(await colHasRow('AXCHILD')))
  const order = await colRowNames()
  const afterFolder = order[order.indexOf('AXFOLDER') + 1] === 'AXDROP' ? order[order.indexOf('AXFOLDER') + 2] : order[order.indexOf('AXFOLDER') + 1]
  await dragTree('AXDROP', afterFolder, 22) // 접힌 폴더 바로 다음 행 위로 오른쪽 → AXFOLDER 로 중첩
  check('Console › Collection: 접힌 폴더로 드롭 시 자동 펼침(아이템 안 사라짐)', (await colHasRow('AXCHILD')) && (await folderOf(ax.dropId)) === ax.fId)

  // 이름 변경 — 행 hover 시 나오는 연필 버튼(사용자 회귀: 컬렉션 이름 수정이 안 되던 문제. 더블클릭만 있어 발견·동작 불가).
  await remountColl('AXDROP')
  await ctx.page.locator('div.group\\/row:has-text("AXDROP")').first().locator('button[title="이름 변경"]').click()
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('aside').first().locator('input:not([placeholder])').first().fill('AXRENAMED')
  await ctx.page.keyboard.press('Enter'); await ctx.page.waitForTimeout(500)
  check('Console › Collection: 연필 버튼으로 컬렉션 이름 변경 저장', await ctx.page.evaluate(async (cid) => (await window.rockury.collections.list(cid)).some((c) => c.name === 'AXRENAMED'), treeIds.cid))

  // 우클릭 컨텍스트 메뉴 + 이동 ▶ 서브메뉴 (Query/Collection 구조 편집 통합)
  const mv = await ctx.page.evaluate(async (cid) => {
    const F = await window.rockury.collections.createFolder({ connectionId: cid, parentId: null, name: 'CTXDEST' })
    const c = await window.rockury.collections.create({ connectionId: cid, name: 'CTXMOVE', folderId: null })
    return { destId: F.id, moveId: c.id }
  }, treeIds.cid)
  await remountColl('CTXMOVE')
  await ctx.page.locator('div.group\\/row:has-text("CTXMOVE")').first().click({ button: 'right' })
  await ctx.page.waitForTimeout(250)
  check('Console › Collection: 우클릭 컨텍스트 메뉴 등장', await ctx.page.locator('button:has-text("이동")').count() > 0)
  // ⭐ 바깥 클릭/Esc 로 닫힌다 (사용자 회귀: 다른 화면 눌러도 안 닫힘)
  await ctx.page.keyboard.press('Escape')
  await ctx.page.waitForTimeout(200)
  check('Console › Collection: 컨텍스트 메뉴 Esc 로 닫힘', await ctx.page.locator('button:has-text("이동")').count() === 0)
  await ctx.page.locator('div.group\\/row:has-text("CTXMOVE")').first().click({ button: 'right' })
  await ctx.page.waitForTimeout(250)
  await ctx.page.locator('button:has-text("이동")').first().click()
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('.absolute button:has-text("CTXDEST")').first().click() // 이동 서브메뉴의 대상 폴더
  await ctx.page.waitForTimeout(500)
  check('Console › Collection: 컨텍스트 이동▶서브메뉴로 폴더 이동', (await folderOf(mv.moveId)) === mv.destId)

  // 컬렉션 설명(description) 편집 저장 (Query 와 동일한 상세 편집)
  await ctx.page.locator('aside').first().locator('button:has-text("CTXMOVE")').first().click()
  await ctx.page.waitForTimeout(300)
  await ctx.page.locator('input[placeholder="설명 추가..."]').first().fill('설명123')
  await ctx.page.keyboard.press('Tab'); await ctx.page.waitForTimeout(500)
  check('Console › Collection: 설명(description) 편집 저장', await ctx.page.evaluate(async (cid) => (await window.rockury.collections.list(cid)).some((c) => c.description === '설명123'), treeIds.cid))

  // Console › History — 독립 뷰(다중 소스): Query 실행 이력이 기록됨
  await click('button:has-text("History")')
  await ctx.page.waitForSelector('text=Source', { timeout: 8_000 })
  await ctx.page.waitForTimeout(300)
  check('Console › History: 실행 이력 기록(Query SQL)', (await body()).includes('SELECT id, email FROM users'))

  // ⭐ History 누적 — 같은 SQL 을 여러 번 실행하면 실행 횟수만큼 쌓인다(사용자 회귀: 안 쌓이고 1행만).
  const histCount = await ctx.page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const sql = 'SELECT 42 AS hist_probe'
    for (let i = 0; i < 3; i++) await window.rockury.query.historyAppend({ connectionId: cid, source: 'query', sql, kind: 'read', status: 'success', rowCount: 1 })
    const list = await window.rockury.query.historyList(cid)
    return list.filter((r) => r.sql === sql).length
  })
  check('Console › History: 같은 SQL 3번 실행 = 3행(중복 접기 없음)', histCount === 3)

  // ⭐ 컬렉션 로그 그룹(아코디언) — 조회 2건 컬렉션을 Run All → History 에서 컬렉션 이름·문 수 그룹, 펼치면 #순번.
  await ctx.page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const c = await window.rockury.collections.create({ connectionId: cid, name: 'GRP_COLL', folderId: null })
    await window.rockury.collections.addItem({ collectionId: c.id, name: 'g1', sql: 'SELECT 1 AS a' })
    await window.rockury.collections.addItem({ collectionId: c.id, name: 'g2', sql: 'SELECT 2 AS b' })
  })
  await click('button:has-text("Collection")')
  await ctx.page.waitForSelector('text=GRP_COLL', { timeout: 8_000 })
  await ctx.page.locator('aside').first().locator('button:has-text("GRP_COLL")').first().click()
  await ctx.page.waitForTimeout(300)
  await click('button:has-text("Run All")')
  await ctx.page.waitForSelector('text=커밋 불필요', { timeout: 15_000 })
  await click('button:has-text("History")')
  await ctx.page.waitForSelector('text=Source', { timeout: 8_000 })
  await ctx.page.waitForTimeout(300)
  check('Console › History: 컬렉션 실행 그룹(GRP_COLL · 2개 쿼리)', (await body()).includes('GRP_COLL') && (await body()).includes('2개 쿼리'))
  await ctx.page.locator('tr:has-text("GRP_COLL")').first().click() // 그룹 펼치기
  await ctx.page.waitForTimeout(250)
  check('Console › History: 그룹 펼치면 컬렉션 내 순번(#1/#2)', (await body()).includes('#1') && (await body()).includes('#2'))

  // Migration › Drift — 기준선 캡처 → 드리프트 없음(Phase 3a/3b · diff② 재사용)
  await click('button:has-text("Migration")')
  await click('button:has-text("Drift")')
  await ctx.page.waitForSelector('text=기준선이 없습니다', { timeout: 15_000 })
  await click('button:has-text("기준선으로 캡처")')
  await ctx.page.waitForSelector('text=드리프트 없음', { timeout: 15_000 })
  check('Migration › Drift: 기준선 캡처 후 드리프트 없음', (await body()).includes('드리프트 없음'))

  // ⭐ 운영→설계: 실 DB 를 설계 새 버전으로 가져오기(version-up) — 드리프트 뷰 진입점(운영→설계 관문).
  const countVersions = () => ctx.page.evaluate(async () => {
    const ds = await window.rockury.designs.list()
    let n = 0
    for (const d of ds) n += (await window.rockury.versions.list(d.id)).length
    return n
  })
  const vBefore = await countVersions()
  await click('button:has-text("설계로 가져오기")')
  await ctx.page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  check('운영→설계: 가져오기 다이얼로그 역설계 미리보기', (await body()).includes('실 DB 에서'))
  await click('button:has-text("새 버전으로 가져오기")')
  await ctx.page.waitForTimeout(1500)
  check('운영→설계: 운영 DB 가져와 설계 새 버전 컷', (await countVersions()) === vBefore + 1)

  // ⭐ 운영→설계(새 설계 부트스트랩): 대상 토글 "새 설계로" → 설계+Draft+버전 생성 + 활성 전환.
  //    (사용자 회귀: 설계가 이미 선택돼 있으면 "새 설계로" 갈 길이 없어 늘 버전업으로 샜다.)
  await click('button:has-text("설계로 가져오기")')
  await ctx.page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  await click('button:has-text("새 설계 만들기")')
  await ctx.page.waitForTimeout(200)
  await ctx.page.locator('input[placeholder="예: commerce-core"]').fill('e2e-imported')
  await click('button:has-text("설계 만들고 가져오기")')
  await ctx.page.waitForTimeout(1800)
  const nd = await ctx.page.evaluate(async () => {
    const d = (await window.rockury.designs.list()).find((x) => x.name === 'e2e-imported')
    if (!d) return { ok: false, tables: 0, versions: 0 }
    const tables = (await window.rockury.tables.list()).filter((t) => t.designId === d.id).length
    const versions = (await window.rockury.versions.list(d.id)).length
    return { ok: true, tables, versions }
  })
  check('운영→설계: 새 설계 부트스트랩(설계 생성)', nd.ok)
  check('운영→설계: 새 설계 Draft 채워짐(Studio 에서 보임)', nd.tables > 0)
  check('운영→설계: 새 설계 첫 버전 컷', nd.versions === 1)
  check('운영→설계: 새 설계가 활성으로 전환됨(드롭다운·헤더 반영)', (await body()).includes('e2e-imported'))

  // ⭐⭐ 시드 반영(설계→운영) + 되먹임(운영→설계) — 실 MySQL 에 트랜잭션 게이트로 쓴다.
  //    대상은 방금 역설계로 들여온 설계(e2e-imported)라 컬럼이 실 DB 와 정확히 맞는다.
  //    CASE-studio-090~094 (docs/qa/db-studio.md). 끝에서 심은 행을 지워 DB 를 원상복구한다.
  {
    const ROLE = 'e2e-seed-role'
    // 검증·정리용 직접 조회는 이 연결로 한다(화면은 활성 연결을 쓰고, 둘은 같은 테스트 DB 다).
    const connId = await ctx.page.evaluate(
      async () => (await window.rockury.connections.list()).find((c) => c.name === 'E2E-mysql')?.id
    )
    const countRole = async (name) =>
      Number(
        (
          await ctx.page.evaluate(
            async ([cid, n]) =>
              window.rockury.query.runParams(cid, 'SELECT COUNT(*) AS c FROM roles WHERE name = ?', [n]),
            [connId, name]
          )
        ).rows[0].c
      )

    // ── 설계에 시드 세트 저작 ──
    await click('button:has-text("Studio")')
    await click('button:has-text("Seed")')
    await ctx.page.waitForTimeout(500)
    await click('button:has-text("테이블에서 시드 세트 만들기")')
    await ctx.page.waitForSelector('[data-seed-candidate="roles"]', { timeout: 8_000 })
    await click('[data-seed-candidate="roles"]')
    await ctx.page.waitForSelector('[data-seed-set-row="roles"]', { timeout: 8_000 })

    const cycleTo2 = async (column, role) => {
      for (let i = 0; i < 4; i++) {
        if ((await ctx.page.locator(`[data-seed-role-toggle="${column}"][data-seed-col-role="${role}"]`).count()) === 1) return
        await click(`[data-seed-role-toggle="${column}"]`)
        await ctx.page.waitForTimeout(150)
      }
    }
    await cycleTo2('name', 'key')
    check('시드 반영: 짝짓기 기준(name) 지정', (await ctx.page.locator('[data-seed-needs-key]').count()) === 0)
    check(
      '시드 반영: UNIQUE 뒷받침되는 기준이라 안내 없음',
      (await ctx.page.locator('[data-seed-key-unbacked]').count()) === 0
    )
    // created_at/updated_at 은 DB 기본값이 있어 필수가 아니다 → 값 없이도 반영된다.
    const fill2 = async (rowIdx, column, value) => {
      await ctx.page.locator('[data-seed-row]').nth(rowIdx).locator(`[data-seed-cell="${column}"]`).click()
      await ctx.page.waitForTimeout(150)
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.type(value)
      await ctx.page.keyboard.press('Enter')
      await ctx.page.waitForTimeout(200)
    }
    await click('button:has-text("행 추가")')
    await ctx.page.waitForSelector('[data-seed-row]', { timeout: 5_000 })
    await fill2(0, 'name', ROLE)
    await fill2(0, 'description', '시드 반영 테스트')
    await ctx.page.waitForTimeout(600) // 설계 스코프 저장 디바운스

    // 규칙 목록의 타입 필터링을 **반대쪽**에서도 확인 — roles.id 는 char(36) 이라 {uuid} 가 나와야
    // 한다(orders 의 BIGINT 에서는 안 나왔다). 고르면 미리보기가 실제 UUID 를 보인다.
    {
      await click('[data-seed-pk-strategy="seed"]')
      await ctx.page.waitForSelector('[data-seed-pk-rule]', { timeout: 5_000 })
      await click('[data-seed-pk-rule]')
      await ctx.page.waitForSelector('[data-seed-pk-rule-option]', { timeout: 5_000 })
      check(
        '시드 반영: char(36) PK 는 {uuid} 를 고를 수 있다',
        (await ctx.page.locator('[data-seed-pk-rule-option="{uuid}"]').count()) === 1
      )
      await click('[data-seed-pk-rule-option="{uuid}"]')
      await ctx.page.waitForTimeout(300)
      const previewed = await ctx.page.locator('[data-seed-pk-preview]').first().getAttribute('data-seed-pk-preview')
      check(
        '시드 반영: {uuid} 미리보기가 UUID 모양이고 타입 경고 없음',
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(previewed ?? '') &&
          (await ctx.page.locator('[data-seed-pk-type-issue]').count()) === 0
      )
      // 원복 — 이 흐름의 반영·되먹임 검증은 DB 가 PK 를 만드는 것을 전제로 한다.
      await click('[data-seed-pk-strategy="db"]')
      await ctx.page.waitForTimeout(400)
    }

    // ── Migration › Seed: 계획 → 적용 → 커밋 ──
    await click('button:has-text("Migration")')
    await click('[data-nav-view="seed"]')
    await ctx.page.waitForSelector('text=시드 반영', { timeout: 8_000 })
    await click('button:has-text("계획 만들기")')
    await ctx.page.waitForSelector('[data-seed-step]', { timeout: 15_000 })
    check('시드 반영: 계획에 넣기 문장 1개', (await ctx.page.locator('[data-seed-step="insert"]').count()) === 1)
    check('시드 반영: 막는 것 없음', (await ctx.page.locator('[data-seed-blockers]').count()) === 0)

    await click('button:has-text("적용")')
    await ctx.page.waitForSelector('[data-seed-tx-gate]', { timeout: 15_000 })
    check('시드 반영: 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
    check('시드 반영: 커밋 전에는 실 DB 에 없다', (await countRole(ROLE)) === 0)

    await click('button:has-text("커밋")')
    await ctx.page.waitForTimeout(1200)
    check('시드 반영: 커밋 후 실 DB 에 심어짐', (await countRole(ROLE)) === 1)
    check('시드 반영: 재계획 시 할 일 없음(멱등)', (await body()).includes('할 일이 없습니다'))

    // ── 되먹임: 실 DB 에서 값을 바꾼 뒤 가져오기 → 채택 → 설계 반영 ──
    await ctx.page.evaluate(
      async ([cid, n]) =>
        window.rockury.query.runParams(cid, 'UPDATE roles SET description = ? WHERE name = ?', ['운영에서 고친 설명', n]),
      [connId, ROLE]
    )
    await click('[data-seed-ops-tab="import"]')
    await click('button:has-text("실 DB 읽기")')
    await ctx.page.waitForSelector('[data-seed-import-row]', { timeout: 15_000 })
    check(
      '시드 되먹임: 값이 다른 행을 후보로 잡는다',
      (await ctx.page.locator('[data-seed-import-row="changed"]').count()) >= 1
    )
    await ctx.page.locator('[data-seed-import-row="changed"] button[role="checkbox"]').first().click()
    await click('[data-seed-import-accept]')
    await ctx.page.waitForTimeout(800)
    const seededDesc = await ctx.page.evaluate(async () => {
      const list = await window.rockury.seedSets.list()
      const s = list.find((x) => x.tableName === 'roles')
      return s?.rows?.[0]?.values?.description ?? null
    })
    check('시드 되먹임: 채택한 값이 설계 시드에 담김', seededDesc === '운영에서 고친 설명')

    // ── DB 원상복구(심은 행 제거) ──
    await ctx.page.evaluate(
      async ([cid, n]) => window.rockury.query.runParams(cid, 'DELETE FROM roles WHERE name = ?', [n]),
      [connId, ROLE]
    )
    check('시드 반영: 정리 후 실 DB 원복', (await countRole(ROLE)) === 0)
  }

  // Migration › Logs — 기준선 로그 기록(Phase 3e)
  await click('button:has-text("Logs")')
  await ctx.page.waitForSelector('text=기준선', { timeout: 8_000 })
  check('Migration › Logs: 기준선 로그 체인', (await body()).includes('기준선'))

  // ⭐ Environment 관리 UI — 연결 카드에서 설계 바인딩 열람(운영↔설계 결속이 화면에 드러남).
  await click('button:has-text("Connections")')
  await ctx.page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  await ctx.page.locator('button[title="설계 바인딩 관리"]').first().click()
  await ctx.page.waitForSelector('text=설계 바인딩 ·', { timeout: 8_000 })
  await ctx.page.waitForSelector('text=commerce-core', { timeout: 8_000 }) // 바인딩 행 비동기 로드 대기
  check('Environment 관리: 연결의 설계 바인딩 다이얼로그(commerce-core 표시)', (await body()).includes('commerce-core'))
  await ctx.page.locator('button:has-text("닫기")').first().click()
  await ctx.page.waitForTimeout(300)

  // ⭐ 운영↔운영 비교(Compare) — 같은 DB 를 가리키는 두 번째 연결과 비교 → 스키마 동일.
  //    IPC 로 만든 연결은 렌더러 스토어(부팅 시 1회 하이드레이션)에 안 잡힘 → reload 로 반영.
  await ctx.page.evaluate(() =>
    window.rockury.connections.create({
      name: 'E2E-mysql2', dbType: 'mysql', host: 'localhost', port: 13306,
      database: 'testdb', user: 'test', password: 'test', sslEnabled: false
    })
  )
  await ctx.page.reload()
  await ctx.page.waitForSelector('text=Studio', { timeout: 15_000 })
  await click('button:has-text("Migration")')
  await click('button:has-text("Compare")')
  await ctx.page.waitForSelector('text=실 DB 간 스키마 비교', { timeout: 8_000 })
  await ctx.page.locator('[data-slot="select-trigger"]').last().click() // 상대 연결 셀렉터
  await ctx.page.locator('[data-slot="select-item"]:has-text("E2E-mysql2")').first().click()
  await click('button:has-text("비교")')
  await ctx.page.waitForSelector('text=두 DB 의 스키마가 동일해요', { timeout: 15_000 })
  check('Migration › Compare: 같은 DB 두 연결 → 스키마 동일', (await body()).includes('두 DB 의 스키마가 동일해요'))

  // ⭐ 버전 삭제(잘못 들어간 버전 회수) — Timeline 에서 삭제 → 목록에서 사라짐.
  await click('button:has-text("Versions")')
  await ctx.page.waitForSelector('text=버전 타임라인', { timeout: 8_000 })
  await ctx.page.waitForTimeout(300)
  const vBeforeDel = await ctx.page.locator('[data-version-number]').count()
  const firstRow = ctx.page.locator('[data-version-number]').first()
  await firstRow.locator('button[title="버전 삭제"]').click({ force: true })
  await firstRow.locator('button:has-text("삭제")').click()
  await ctx.page.waitForTimeout(500)
  check('버전 삭제: Timeline 에서 버전 제거', (await ctx.page.locator('[data-version-number]').count()) === vBeforeDel - 1)

  // ⭐ 콜드 재시작(프로세스 종료→재기동, 같은 userData) 후 연결 잔존 — 진짜 영속 검증.
  //    (renderer reload 가 아니라 실제 앱을 껐다 켠다. 사용자가 겪은 시나리오.)
  await ctx.restart()
  await ctx.page.waitForSelector('text=Studio', { timeout: 15_000 })
  await click('button:has-text("Connections")')
  await ctx.page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  check('콜드 재시작 후 연결 잔존(SQLite 영속)', (await body()).includes('E2E-mysql'))

  // 시드 세트도 콜드 재시작을 넘긴다 — CASE-studio-044(선언·행 잔존).
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await ctx.page.waitForTimeout(300)
  await click('button:has-text("Studio")')
  await click('button:has-text("Seed")')
  await ctx.page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
  const seedAfterRestart = await body()
  check('콜드 재시작 후 시드 세트·행 잔존',
    seedAfterRestart.includes('SEED-0001') && seedAfterRestart.includes('SEED-0002'))
  check('콜드 재시작 후 변수 셀 잔존', (await ctx.page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

  // 회귀: 재시작 직후(세트를 클릭하지 않은 상태)에도 편집이 먹어야 한다 — activeKey 가 비어 있어
  //   스토어가 대상 세트를 못 찾고 조용히 no-op 되던 문제.
  {
    const before = await ctx.page.locator('[data-seed-row]').count()
    await click('button:has-text("행 추가")')
    await ctx.page.waitForTimeout(300)
    check('재시작 직후 편집 반영(행 추가 no-op 회귀)', (await ctx.page.locator('[data-seed-row]').count()) === before + 1)
  }
}
