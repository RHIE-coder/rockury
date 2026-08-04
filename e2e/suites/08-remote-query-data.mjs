// 스모크 스위트 — Remote › Query/Data — 저장쿼리·트랜잭션 게이트·데이터 편집
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '08-remote-query-data',
  needsDb: true,
  desc: 'Remote › Query/Data — 저장쿼리·트랜잭션 게이트·데이터 편집'
}

export async function run(ctx) {
  const { check, click, body, typeSql } = ctx
  let page = ctx.page
  // Remote › Query — 저장쿼리 객체 트리 + 편집기(재설계). 새 쿼리 생성 → SELECT 실행.
  await click('button:has-text("Query")')
  await page.waitForSelector('.cm-content', { timeout: 15_000 })
  await click('button[title="새 쿼리"]')
  await page.waitForTimeout(400)
  // 구조 편집 통합: Query 트리 행에도 호버 편집(연필)/삭제 아이콘이 있어야 한다(Collection 과 동일).
  {
    const qrow = page.locator('div.group\\/row:has-text("Untitled Query")').first()
    check('Remote › Query: 트리 행 이름변경(연필)+삭제 아이콘', (await qrow.locator('button[title="이름 변경"]').count()) > 0 && (await qrow.locator('button[title="삭제"]').count()) > 0)
  }
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await click('button:has-text("Run")')
  await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Remote › Query: SELECT 결과 그리드', (await body()).includes('email'))
  await page.waitForTimeout(1200) // 자동저장(라이브러리 쿼리에 SQL 반영)

  // EXPLAIN — 실행 계획(실제 반영 없음)
  await click('button[title="실행 계획(EXPLAIN)"]')
  await page.waitForSelector('text=실행 계획', { timeout: 15_000 })
  check('Remote › Query: EXPLAIN 실행 계획', (await body()).includes('실행 계획'))

  // 스키마 사이드 패널(기본 열림) — 테이블/컬럼 트리 (T12)
  check('Remote › Query: 스키마 패널(user_roles)', (await body()).includes('user_roles'))

  // ⭐ 좌·우·양쪽 패널 접기/펼치기 (§db-design.definition.side-panel AC-5/AC-5a)
  {
    const W = async (sel) => Math.round((await page.locator(sel).first().boundingBox())?.width ?? -1)
    const L0 = await W('[data-workspace-sidebar]')
    const R0 = await W('[data-workspace-right]')
    await page.locator('[data-sidebar-collapse]').first().click()
    await page.waitForTimeout(350)
    check(
      'Remote › Query: 왼쪽 패널 접기 → 폭 0 + 세로 띠',
      L0 > 0 && (await W('[data-workspace-sidebar]')) === 0 && (await page.locator('[data-sidebar-expand]').count()) === 1
    )
    await page.locator('[data-sidebar-expand]').first().click()
    await page.waitForTimeout(350)

    await page.locator('[data-right-collapse]').first().click()
    await page.waitForTimeout(350)
    check(
      'Remote › Query: 오른쪽 패널 접기 → 폭 0 + 세로 띠',
      R0 > 0 && (await W('[data-workspace-right]')) === 0 && (await page.locator('[data-right-expand]').count()) === 1
    )
    await page.locator('[data-right-expand]').first().click()
    await page.waitForTimeout(350)

    // 양쪽 손잡이는 어느 상태에서도 닿아야 한다 — 접으면 띠에, 펴면 머리줄에 선다.
    await page.locator('[data-panels-both]').first().click()
    await page.waitForTimeout(400)
    check(
      'Remote › Query: 양쪽 한 번에 접기',
      (await W('[data-workspace-sidebar]')) === 0 && (await W('[data-workspace-right]')) === 0
    )
    await page.locator('[data-panels-both]').first().click()
    await page.waitForTimeout(400)
    check(
      'Remote › Query: 양쪽 한 번에 펼치기(접기 전 폭으로)',
      (await W('[data-workspace-sidebar]')) === L0 && (await W('[data-workspace-right]')) === R0
    )
  }

  // ⭐ 결과 행 상세 모달 — 표에서 잘리는 긴 값·JSON 을 자르지 않고 펴 본다 (§result-grid.row-detail)
  {
    await typeSql('SELECT id, preferences FROM user_profiles LIMIT 3')
    await page.waitForTimeout(300)
    await click('button:has-text("Run")')
    await page.waitForSelector('[data-result-row]', { timeout: 15_000 })
    await page.locator('[data-result-row="0"]').first().click()
    await page.waitForSelector('[data-row-detail]', { timeout: 8_000 })
    const detail = await page.locator('[data-row-detail]').innerText()
    check('Remote › Query: 행 클릭 → 상세 모달', detail.includes('1행'))
    check(
      'Remote › Query: 상세의 JSON 은 들여써서 보인다',
      (await page.locator('[data-row-detail] pre').count()) > 0
    )
    await page.locator('[data-row-detail-next]').first().click()
    await page.waitForTimeout(300)
    check('Remote › Query: 상세에서 다음 행으로 넘어간다', (await page.locator('[data-row-detail]').innerText()).includes('2행'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // 파라미터화 쿼리 — {{키워드}} 입력 시 파라미터 바 노출 (T11)
  await typeSql('SELECT * FROM users WHERE id = {{uid}}')
  await page.waitForTimeout(300)
  check('Remote › Query: {{키워드}} 파라미터 바', (await body()).includes('파라미터'))

  // ⭐ 파괴적 트랜잭션 게이트 — WHERE 없는 UPDATE → 커밋 대기 바 → 롤백
  await typeSql('UPDATE users SET is_active = is_active')
  await click('button:has-text("Run")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Remote › Query: DML 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Remote › Query: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 저장쿼리 SQL 을 깨끗한 SELECT 로 복원(자동저장) — Collection 참조 실행용
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await page.waitForTimeout(1200)

  // Remote › Data — 조회 + 편집(수정→트랜잭션 게이트→롤백)(Phase 2b)
  await click('button:has-text("Data")')
  // 사이드 패널은 Definition·Diagram 과 같은 공용 부품이다 — 행은 이름 훅으로 집는다
  // (예전엔 이 화면만 자체 `aside` 목록이었다).
  await page.waitForSelector('[data-table-row="users"]', { timeout: 15_000 })
  await click('[data-table-row="users"]')
  await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Remote › Data: users 행 조회', (await body()).includes('email'))

  // 컬럼 정렬(ORDER BY — 파라미터 바인드 SELECT 재조회)
  await click('th button:has-text("email")')
  await page.waitForTimeout(500)
  check('Remote › Data: 컬럼 정렬 재조회', (await body()).includes('email'))

  // ⭐ 툴바 드롭다운(타임존)은 바깥 클릭/Esc 로 닫힌다 (사용자 회귀: 다른 곳 눌러도 안 닫힘)
  await click('button[title^="날짜 표시"]')
  await page.waitForSelector('text="LOCAL"', { timeout: 5_000 })
  check('Remote › Data: 타임존 드롭다운 열림', (await page.locator('text="LOCAL"').count()) > 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Remote › Data: 타임존 드롭다운 Esc 로 닫힘', (await page.locator('text="LOCAL"').count()) === 0)

  // 첫 행 first_name(2번째 입력) 수정 → 저장 → 게이트 → 롤백
  await page.locator('tbody tr').first().locator('input').nth(1).fill('E2E-edit')
  await page.waitForSelector('button:has-text("저장")', { timeout: 5_000 })
  await click('button:has-text("저장")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Remote › Data: 편집 트랜잭션 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Remote › Data: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 키 배지(PK/FK/UK 텍스트) + 타입 라벨(char/varchar) (T1)
  check('Remote › Data: 키 배지(PK)+타입 라벨', (await body()).includes('PK'))
  // Constraints 탭 — 전역 제약 목록(읽기 전용) (T10)
  await click('[data-side-tab="constraints"]')
  await page.waitForTimeout(500)
  check('Remote › Data: Constraints 탭 제약 목록(PRIMARY)', (await body()).includes('PRIMARY'))
  await click('[data-side-tab="tables"]')
  await page.waitForTimeout(200)

  // ⭐ Data 의 행 상세 — 행 번호가 손잡이다(셀은 눌러 편집하는 자리라 행 전체는 못 쓴다).
  {
    await page.locator('[data-result-row="0"]').first().click()
    await page.waitForSelector('[data-row-detail]', { timeout: 8_000 })
    const detail = await page.locator('[data-row-detail]').innerText()
    check('Remote › Data: 행 번호 클릭 → 행 상세 모달', detail.includes('1행'))
    // 상세는 "이 행 전부" — 숨김 설정과 무관하게 표의 컬럼이 모두 뜬다.
    check('Remote › Data: 상세에 컬럼이 모두 뜬다(email)', detail.includes('email'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // JSON 값 — 셀은 구조 요약 칩(`{} n`)으로 보이고, 눌러 열면 정렬된 뷰어가 형식 정상 여부까지 알려 준다.
  await click('[data-table-row="user_profiles"]')
  await page.waitForSelector('tbody tr', { timeout: 15_000 })
  await page.waitForTimeout(300)
  {
    const jsonCell = page.locator('tbody button[title*="눌러서 전체 보기"]').first()
    check('Remote › Data: JSON 셀이 구조 요약으로 보임', (await jsonCell.count()) > 0)
    await jsonCell.click()
    await page.waitForSelector('text=형식 정상', { timeout: 8_000 })
    const viewer = await body()
    check('Remote › Data: JSON 뷰어 열림(형식 정상 표시)', viewer.includes('형식 정상'))
    check('Remote › Data: JSON 뷰어가 보기 좋게 정렬해 보여줌', viewer.includes('한 줄로'))
    await click('button:text-is("취소")')
    await page.waitForTimeout(200)
  }

  // FK 참조 선택 모달 — FK 셀의 FK 버튼 클릭 → 모달(검색·페이지·Set NULL/Cancel/Apply) (사용자 보고 회귀 방지)
  await click('[data-table-row="user_roles"]')
  await page.waitForSelector('tbody tr', { timeout: 15_000 })
  await page.waitForTimeout(300)
  await click('button[title$="참조 선택"]')
  await page.waitForSelector('button:has-text("Set NULL")', { timeout: 8_000 })
  check('Remote › Data: FK 참조 선택 모달 열림', (await body()).includes('참조 선택'))
  await click('button:has-text("Cancel")')
  await page.waitForTimeout(200)

}
