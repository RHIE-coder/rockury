// 스모크 스위트 — Console › Diagram/Definition — 실 DB 역설계 ERD·정의·라이브 스키마 편집
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '07-console-schema',
  needsDb: true,
  desc: 'Console › Diagram/Definition — 실 DB 역설계 ERD·정의·라이브 스키마 편집'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Console › Diagram — 같은 introspection TableDef[] 를 ERD 그래프로(Phase 2e · @xyflow+dagre).
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  await page.waitForTimeout(400)
  const diag = await body()
  check(
    'Console › Diagram: ERD 노드(users/user_roles) 렌더',
    (await page.locator('.react-flow__node').count()) > 0 && diag.includes('users') && diag.includes('user_roles')
  )
  // FK 관계가 엣지로 그려진다(예: user_roles → users).
  check('Console › Diagram: 관계 엣지(react-flow__edge) 존재', (await page.locator('.react-flow__edge').count()) > 0)

  // ⭐ v2 레이아웃 영속 — 노드를 드래그하면 위치가 저장되고, 탭을 벗어났다 와도 복원된다.
  const nodeTf = async (id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).first().evaluate((el) => el.style.transform)
  {
    const nd = page.locator('.react-flow__node[data-id="t:users"]').first()
    // ⚠ 오버레이(미니맵·컨트롤)에 덮이면 mousedown 이 그쪽으로 가 드래그가 조용히 안 되고,
    //   그 뒤 "왕복 후 복원" 비교는 둘 다 안 움직인 값이라 **거짓 통과**한다 → 먼저 집힘을 확인.
    const grab = await ctx.nodeGrabPoint(nd)
    check('Console › Diagram: 드래그 대상(t:users)이 오버레이에 안 덮임', !!grab)
    const tfPre = await nodeTf('t:users')
    await page.mouse.move(grab.from.x, grab.from.y)
    await page.mouse.down()
    await page.mouse.move(grab.from.x + 160, grab.from.y + 110, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500) // onNodeDragStop → saveLayout(IPC)
    const dragged = await nodeTf('t:users')
    check('Console › Diagram: 드래그로 노드가 실제로 움직임', dragged !== tfPre)
    const savedCount = await page.evaluate(async () => {
      const cid = (await window.rockury.connections.list())[0].id
      const l = await window.rockury.diagram.getLayout(cid)
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Console › Diagram: 드래그 → 레이아웃 저장(getLayout 비어있지 않음)', savedCount > 0)
    // Object 탭으로 나갔다가 Diagram 으로 복귀 → 저장된 위치로 복원(dagre 기본이 아님)
    await click('button:has-text("Object")')
    await page.waitForTimeout(300)
    await click('button:has-text("Diagram")')
    await page.waitForSelector('.react-flow__node[data-id="t:users"]', { timeout: 15_000 })
    await page.waitForTimeout(400)
    const restored = await nodeTf('t:users')
    check('Console › Diagram: 탭 왕복 후 드래그 위치 복원', restored === dragged)
  }

  // 검색 — 매칭 테이블만 강조(data-erd-match). 'user' → users/user_roles 매칭.
  await page.locator('input[placeholder="테이블/컬럼 검색"]').fill('user')
  await page.waitForTimeout(300)
  check('Console › Diagram: 검색 매칭 강조', (await page.locator('[data-erd-match="true"]').count()) > 0)
  await page.locator('input[placeholder="테이블/컬럼 검색"]').fill('')
  await page.waitForTimeout(200)
  check('Console › Diagram: 검색 지우면 강조 해제', (await page.locator('[data-erd-match="true"]').count()) === 0)

  // 간략 토글 — 컬럼 접힘(data-erd-compact).
  await click('button:has-text("간략")')
  await page.waitForTimeout(200)
  check('Console › Diagram: 간략 토글 → 컬럼 접힘', (await page.locator('[data-erd-compact="true"]').count()) > 0)
  await click('button:has-text("간략")') // 원복
  await page.waitForTimeout(150)

  // 좌측 테이블 목록 패널 — Data 사이드바와 같은 구성. 항목을 누르면 그 테이블로 캔버스가 이동한다.
  {
    const panel = page.locator('[data-diagram-table-panel]')
    check('Console › Diagram: 좌측 테이블 목록 패널 존재', (await panel.count()) > 0)
    const viewport = page.locator('.react-flow__viewport').first()
    const before = await viewport.getAttribute('style')
    await panel.locator('[data-table-row="user_roles"]').first().click()
    await page.waitForTimeout(900) // fitView 애니메이션(400ms) 여유
    const after = await viewport.getAttribute('style')
    check('Console › Diagram: 목록 클릭 → 해당 테이블로 캔버스 이동(포커싱)', before !== after)
  }

  // 내보내기 — PNG 클릭 → html-to-image 캡처 성공(toolbar data-export-status=ok).
  // (Electron 에선 data-URL 다운로드 이벤트가 Playwright 로 안 잡혀, 캡처 성공 여부를 상태로 검증.)
  await page.locator('.react-flow__panel button:has-text("PNG")').first().click()
  await page.waitForSelector('[data-export-status="ok"]', { timeout: 15_000 })
  check('Console › Diagram: PNG 내보내기(html-to-image 캡처 성공)', (await page.locator('[data-export-status="ok"]').count()) > 0)

  // Console › Diagram 편집 — 편집 진입 → 노드 선택 시 편집 패널 → 캔버스 + 로 테이블 추가(노드 증가·대기 변경) → 버리기.
  // (적용 파이프라인은 Definition 에서 실 DB 왕복으로 검증됨 — 여기선 다이어그램 편집 UI 만 확인, DB 무변경.)
  await click('button:text-is("편집")')
  await page.waitForSelector('.react-flow__node', { timeout: 10_000 })
  await page.waitForTimeout(300)
  const editNodes0 = await page.locator('.react-flow__node').count()
  await page.locator('.react-flow__node').first().click()
  await page.waitForTimeout(300)
  check('Console › Diagram 편집: 노드 선택 → 편집 패널(관계(FK))', (await body()).includes('관계(FK)'))
  await page.locator('.react-flow__panel button:has-text("테이블")').first().click()
  await page.waitForTimeout(400)
  check('Console › Diagram 편집: 캔버스 + → 노드 증가 + 대기 변경', (await page.locator('.react-flow__node').count()) > editNodes0 && (await body()).includes('대기 변경'))
  await click('button:has-text("버리기")')
  await page.waitForSelector('button:text-is("편집")', { timeout: 10_000 })
  check('Console › Diagram 편집: 버리기 → 읽기 모드 복귀', (await page.locator('button:text-is("편집")').count()) > 0)

  // Console › Definition — 같은 introspection TableDef[] 를 Studio Definition 형태(목록 | 상세/DDL)로.
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const defBody = await body()
  check(
    'Console › Definition: 사이드바 실 DB 테이블 목록(users/user_roles)',
    defBody.includes('users') && defBody.includes('user_roles')
  )
  // 목록은 테이블과 뷰(view)를 갈라 보인다 — 테스트 DB 의 v_user_summary 가 뷰 묶음에 들어간다.
  check(
    'Console › Definition: 목록이 테이블/뷰를 가른다(v_user_summary 는 뷰)',
    (await page.locator('[data-table-row="v_user_summary"]').count()) > 0 && defBody.includes('뷰')
  )

  // 사이드바에서 테이블 선택 → SQL(DDL) 뷰 토글 → 실 introspection + generateDdl 로 CREATE 문 렌더.
  // NOTE: 토글은 :text-is 로 정확 일치 — has-text 는 ContextBar 의 "MySQL" 버튼까지 잡는다.
  await page.locator('[data-table-row="user_roles"]').first().click()
  await page.waitForTimeout(200)

  // FK 정책은 ON DELETE·ON UPDATE 를 **둘 다** 보인다(실 DB 는 두 값을 다 주는데 전엔 삭제 쪽만 그렸다).
  {
    const fkBody = await body()
    check(
      'Console › Definition: FK 정책 ON DELETE·ON UPDATE 동시 표기',
      fkBody.includes('ON DELETE CASCADE') && fkBody.includes('ON UPDATE CASCADE')
    )
  }
  await click('button:text-is("SQL")')
  await page.waitForSelector('text=CREATE TABLE', { timeout: 10_000 })
  const ddlBody = await body()
  check(
    'Console › Definition: SQL 뷰 DDL(CREATE TABLE user_roles) 렌더',
    ddlBody.includes('CREATE TABLE') && ddlBody.includes('user_roles')
  )
  await click('button:text-is("Table")') // Table 폼으로 복귀
  await page.waitForTimeout(150)

  // Console › Definition 편집 — 라이브 스키마 편집: 대기 변경 → DDL 미리보기 → tx 게이트 적용 → 재역설계.
  // 공유 테스트 DB 를 오염시키지 않도록 rky_probe 를 만들었다 되지운다(생성/삭제 왕복 = 클린).
  await click('button:text-is("편집")')
  await page.waitForTimeout(200)
  await page.locator('button[aria-label="테이블 추가"]').first().click()
  await page.waitForTimeout(200)
  await page.locator('input[placeholder="테이블명"]').fill('rky_probe')
  await page.locator('button:has-text("컬럼 추가")').first().click()
  await page.waitForTimeout(150)
  await page.locator('input[placeholder="컬럼명"]').last().fill('note')
  await page.waitForTimeout(150)
  check('Console › Definition 편집: 대기 변경 미리보기', (await body()).includes('대기 변경'))
  await click('button:text-is("적용")')
  await page.waitForSelector('button:text-is("편집")', { timeout: 15_000 }) // 편집 종료 = 적용 완료
  await page.waitForTimeout(500)
  check('Console › Definition 편집: 생성 적용 → 재역설계에 rky_probe 반영', (await body()).includes('rky_probe'))

  // 파괴적 편집(테이블 삭제) — 경고 후 적용, DB 를 원상 복구(rky_probe 제거).
  await click('button:text-is("편집")')
  await page.waitForTimeout(200)
  await page.locator('[data-table-row="rky_probe"]').first().click()
  await page.waitForTimeout(200)
  await page.locator('button[aria-label="테이블 메뉴"]').first().click()
  await page.waitForTimeout(150)
  await click('[role="menuitem"]:has-text("테이블 삭제")')
  await page.waitForTimeout(200)
  check('Console › Definition 편집: 삭제는 파괴적 경고 표시', (await body()).includes('파괴적'))
  await click('button:text-is("적용")') // window.confirm 은 acceptDialogs 로 자동 수락
  await page.waitForSelector('button:text-is("편집")', { timeout: 15_000 })
  await page.waitForTimeout(500)
  check('Console › Definition 편집: 삭제 적용 → rky_probe 사라짐(DB 원복)', !(await body()).includes('rky_probe'))

}
