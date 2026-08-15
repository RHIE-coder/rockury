// 스모크 스위트 — Remote › Query/Data — 저장쿼리·트랜잭션 게이트·데이터 편집
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

import { isRedFamily } from '../lib/harness.mjs'

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
  // 쿼리를 고르기 전엔 편집기가 아예 없다(2026-08-12) — 새 쿼리를 만들어야 편집기가 뜬다.
  await page.waitForSelector('button[title="새 쿼리"]', { timeout: 15_000 })
  check('Remote › Query: 고른 쿼리가 없으면 편집기가 없다', (await page.locator('.cm-content').count()) === 0)
  await click('button[title="새 쿼리"]')
  await page.waitForSelector('.cm-content', { timeout: 15_000 })
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

  // ⭐ 회귀(2026-08-12 유실 사고) — 저장한 쿼리를 트리에서 눌러 열면 써 둔 SQL 이 그대로 있어야 한다.
  // 예전엔 트리가 든 낡은 사본(빈 SQL)이 편집기에 실렸고, 이어서 그 빈 것이 저장소를 덮어
  // 사용자가 써 둔 쿼리가 통째로 사라졌다.
  {
    const editorText = async () => (await page.locator('.cm-content').first().innerText()).replace(/\s+/g, ' ')
    const openRow = async () => {
      await page.locator('div.group\\/row:has-text("Untitled Query")').first().locator('button').first().click()
      await page.waitForTimeout(600)
    }
    await openRow()
    check('Remote › Query: 저장쿼리를 눌러 열어도 SQL 이 그대로다', (await editorText()).includes('FROM users'))
    // 자동저장 늦춤 시간을 넘겨 다시 열어 본다 — 여는 행위가 저장소를 덮었다면 여기서 빈다.
    await page.waitForTimeout(1300)
    await openRow()
    check('Remote › Query: 다시 열어도 저장소의 SQL 이 멀쩡하다', (await editorText()).includes('FROM users'))
  }

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

  // ── 새로고침이 스키마까지 다시 읽는다 (2026-08-04 사용자 실측 회귀) ──
  // 밖에서 실 DB 컬럼을 바꾸고 새로고침을 눌렀더니 **모든 칸이 undefined** 로 떴다. 조회는
  // SELECT * 라 행에는 새 컬럼이 담기는데, 헤더는 캐시된 옛 역설계 결과였다(앱을 껐다 켜야 반영).
  // Definition·Diagram·Object 는 처음부터 역설계를 다시 읽고 있었고 Data 만 행만 읽고 있었다.
  {
    const connId = await page.evaluate(() => window.rockury.nav?.connId ?? null)
    const conn = connId ?? (await page.evaluate(() => window.__rockuryNav.activeContext().conn ?? null))
    const run = (sql) => page.evaluate(([id, s]) => window.rockury.query.run(id, s), [conn, sql])
    // 셀 값은 <input> 안에 있어 innerText 로는 안 잡힌다.
    const cellValues = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('tbody td')].map((td) => {
          const i = td.querySelector('input')
          return i ? i.value : td.innerText.trim()
        })
      )

    await run('DROP TABLE IF EXISTS refresh_probe')
    await run('CREATE TABLE refresh_probe (id int primary key, old_col text)')
    await run("INSERT INTO refresh_probe VALUES (1, 'before')")

    // 새 표가 목록에 뜨게 역설계를 한 번 갱신하고 연다.
    await click('button:has-text("새로고침")')
    await page.waitForSelector('[data-table-row="refresh_probe"]', { timeout: 15_000 })
    await click('[data-table-row="refresh_probe"]')
    await page.waitForSelector('th:has-text("old_col")', { timeout: 10_000 })
    check('Remote › Data: 표를 열면 그때의 컬럼이 헤더에 뜬다', (await body()).includes('old_col'))

    // 밖에서 스키마를 바꾼다.
    await run('ALTER TABLE refresh_probe RENAME COLUMN old_col TO new_col')
    await run('ALTER TABLE refresh_probe ADD COLUMN extra text')
    await run("UPDATE refresh_probe SET extra = 'added'")

    await click('button:has-text("새로고침")')
    await page.waitForSelector('th:has-text("new_col")', { timeout: 10_000 })
    await page.waitForTimeout(500)
    const after = await body()
    const cells = (await cellValues()).join(' ')

    check('Remote › Data: 새로고침이 바뀐 컬럼을 헤더에 반영한다', after.includes('new_col'))
    check('Remote › Data: 새로고침이 새로 생긴 컬럼도 보인다', after.includes('extra'))
    check('Remote › Data: 사라진 컬럼은 헤더에서 빠진다', !after.includes('old_col'))
    check('Remote › Data: 값이 undefined 로 뜨지 않는다', !after.includes('undefined'))
    check('Remote › Data: 실제 데이터가 그대로 보인다', cells.includes('before') && cells.includes('added'))

    await run('DROP TABLE IF EXISTS refresh_probe')
  }

  // ⭐ 회귀(2026-08-08 제보) — §db-remote.data.grid AC-8 · CASE-remote-04R.
  //
  // 표를 바꾸면 헤더는 새 표(역설계)에서 곧장 오는데 행만 옛것으로 남아, 없는 키로 값을 꺼내
  // 편집 칸마다 글자 `undefined` 가 찍혔다.
  //
  // 로컬 도커 조회는 눈 깜짝할 새 끝나서, 전환 뒤에 한 번 들여다보는 식으로는 그 순간을 놓치고
  // **조용히 통과**한다. 늦추려고 `window.rockury.query.runParams` 를 감싸 봤지만 안 된다 —
  // contextBridge 로 건너온 객체는 렌더러에서 못 덮어쓴다(실측). 그래서 지켜보는 쪽을 바꾼다:
  // 전환 **전에** MutationObserver 를 걸어 그 사이 그려진 **모든 프레임**을 훑는다. 로딩이
  // 1ms 든 1s 든 React 가 그린 적이 있으면 반드시 걸린다.
  {
    await click('[data-table-row="users"]')
    await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })

    await page.evaluate(() => {
      const SPIN = '[role="status"][aria-label="불러오는 중"]'
      window.__watch = { undef: false, spin: false, rowsWhileSpin: -1 }
      const scan = () => {
        // 셀 값은 <input> 안에 있어 textContent 로는 안 잡힌다.
        for (const td of document.querySelectorAll('tbody td')) {
          const i = td.querySelector('input')
          if ((i ? i.value : td.textContent) === 'undefined') window.__watch.undef = true
        }
      }
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue
            if (n.matches?.(SPIN) || n.querySelector?.(SPIN)) {
              window.__watch.spin = true
              // 도는 표시가 떠 있는 그 프레임에 옛 행이 남아 있었는지 — 이게 회귀의 핵심이다.
              window.__watch.rowsWhileSpin = document.querySelectorAll('tbody tr').length
            }
          }
        }
        scan()
      })
      obs.observe(document.body, { childList: true, subtree: true, characterData: true })
      window.__stopWatch = () => obs.disconnect()
    })

    await click('[data-table-row="user_roles"]')
    await page.waitForSelector('th:has-text("role_id")', { timeout: 15_000 })
    await page.waitForTimeout(600)
    const w = await page.evaluate(() => {
      window.__stopWatch?.()
      return window.__watch
    })
    const done = await page.evaluate(() =>
      [...document.querySelectorAll('tbody td')].map((td) => {
        const i = td.querySelector('input')
        return i ? i.value : td.innerText.trim()
      })
    )

    check('Remote › Data: 표를 바꾸는 내내 undefined 가 한 번도 안 찍힌다', !w.undef)
    check('Remote › Data: 표를 바꾸면 불러오는 동안 도는 표시가 뜬다', w.spin)
    // 도는 표시를 못 봤으면 옛 행 검사는 판정할 게 없다 — 조용히 통과시키지 않고 그대로 드러낸다.
    check(
      'Remote › Data: 도는 표시가 뜬 그 순간 옛 표의 행이 없다',
      w.spin && w.rowsWhileSpin === 0
    )
    check('Remote › Data: 다 읽고 나면 새 표의 행이 뜬다', done.length > 0)
    check('Remote › Data: 다 읽은 뒤에도 undefined 가 없다', !done.join(' ').includes('undefined'))
  }

  // ⭐ CASE-remote-04K/04L/04M/04N — 쪽 넘김·필터·저장 필터(2026-08-07 사용자 요청)
  // §db-remote.data.paging · data.filter · data.saved-filter
  {
    await click('button:has-text("새로고침")')
    await page.waitForSelector('[data-table-row="users"]', { timeout: 15_000 })
    await click('[data-table-row="users"]')
    await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
    await page.waitForTimeout(1000) // 행 수 세기는 조회와 따로 돈다(§paging AC-4)

    const pageInput = () => page.locator('input[aria-label="쪽 번호"]')
    const valueBox = () => page.locator('input[placeholder="값"]').first()
    const rows = () => page.locator('tbody tr').count()
    // 필터 바는 표를 바꿔도 열린 채 남는다(패널 토글) — 이미 열렸는데 또 누르면 닫힌다.
    const openFilterBar = async () => {
      if ((await page.locator('[data-filter-toggle]').count()) === 0) await click('button:has-text("필터")')
      await page.waitForSelector('[data-filter-toggle]', { timeout: 5_000 })
    }

    check('Remote › Data: 쪽 입력 칸이 1쪽을 가리킨다', (await pageInput().inputValue()) === '1')
    check('Remote › Data: 조건에 맞는 전체 행 수를 보인다', /전체 \d/.test(await body()))

    // ── 필터 바: 컬럼·연산자를 **검색 카드**로 고른다(§data.filter AC-1/AC-1b) ──
    const baseRows = await rows()
    await openFilterBar()
    check('Remote › Data: 필터 바 스위치가 켜져 있다', (await body()).includes('조건 켬'))

    await click('[data-search-select="filter-column"]')
    await page.waitForSelector('input[placeholder="컬럼 검색"]', { timeout: 5_000 })
    await page.locator('input[placeholder="컬럼 검색"]').fill('ema')
    await page.waitForTimeout(250)
    const card = await page.locator('div:has(> div > input[placeholder="컬럼 검색"])').last().innerText()
    check('Remote › Data: 검색 카드가 타이핑으로 컬럼을 좁힌다', card.includes('email') && !/\bid\b/.test(card))
    await page.keyboard.press('Enter') // 키보드만으로 고를 수 있다
    await page.waitForTimeout(250)

    await click('[data-search-select="filter-op"]')
    await page.waitForSelector('input[placeholder="연산자 검색"]', { timeout: 5_000 })
    await page.locator('input[placeholder="연산자 검색"]').fill('비슷')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    check(
      'Remote › Data: 연산자도 검색으로 고른다(LIKE)',
      (await page.locator('[data-search-select="filter-op"]').first().innerText()).includes('LIKE')
    )

    await valueBox().fill('%a%')
    // `:has-text` 는 부분일치라 "조건 켬" 스위치까지 걸린다 — 정확히 "적용"인 버튼을 집는다.
    await page.locator('button:text-is("적용")').first().click()
    await page.waitForTimeout(1200)
    const filtered = await rows()
    check('Remote › Data: 필터 적용', filtered <= baseRows)

    // ── 켬/끔: 조건을 지우지 않고 전체를 본다(§data.filter AC-3) ──
    await click('[data-filter-toggle="on"]')
    await page.waitForTimeout(1200)
    check('Remote › Data: 필터를 끄면 전체 목록이 돌아온다', (await rows()) >= filtered)
    check('Remote › Data: 꺼도 조건 줄은 그대로 남는다', (await valueBox().inputValue()) === '%a%')
    await click('[data-filter-toggle="off"]')
    await page.waitForTimeout(1200)
    check('Remote › Data: 다시 켜면 같은 조건이 걸린다', (await rows()) === filtered)

    // ── 저장 필터(§data.saved-filter AC-1/AC-2) ──
    await click('[data-saved-filters]')
    await page.waitForTimeout(300)
    check('Remote › Data: 저장한 필터가 아직 없다', (await body()).includes('저장한 필터 없음'))
    await page.keyboard.press('Escape')

    await click('[data-save-filter]')
    await page.waitForSelector('input[placeholder="필터 이름"]', { timeout: 5_000 })
    await page.locator('input[placeholder="필터 이름"]').fill('메일에 a')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    await click('[data-saved-filters]')
    await page.waitForSelector('[data-saved-filter="메일에 a"]', { timeout: 5_000 })
    check('Remote › Data: 이름 붙여 저장한 필터가 목록에 뜬다', (await page.locator('[data-saved-filter="메일에 a"]').count()) === 1)
    await page.keyboard.press('Escape')

    await click('button:has-text("조건 지우기")')
    await page.waitForTimeout(1200)
    check('Remote › Data: 조건 지우기는 조건을 비운다', (await valueBox().inputValue()) === '')
    await click('[data-saved-filters]')
    await page.waitForSelector('[data-saved-filter="메일에 a"]', { timeout: 5_000 })
    await page.locator('[data-saved-filter="메일에 a"] button').first().click()
    await page.waitForTimeout(1200)
    check('Remote › Data: 저장 필터를 골라 조건이 되살아난다', (await valueBox().inputValue()) === '%a%')

    // ── 표마다 따로 산다(§data.filter AC-2 · saved-filter AC-2) ──
    await click('[data-table-row="user_roles"]')
    await page.waitForTimeout(1500)
    check('Remote › Data: 다른 표에 조건이 옮겨붙지 않는다', (await valueBox().inputValue().catch(() => '')) === '')
    await click('[data-saved-filters]')
    await page.waitForTimeout(400)
    check('Remote › Data: 저장 필터도 그 표에만 보인다', (await page.locator('[data-saved-filter="메일에 a"]').count()) === 0)
    await page.keyboard.press('Escape')
    await click('[data-table-row="users"]')
    await page.waitForTimeout(1500)
    check('Remote › Data: 표를 옮겼다 돌아오면 그 표의 조건이 그대로다', (await valueBox().inputValue()) === '%a%')

    // ── 쪽 넘김: 행이 많은 표에서 총 쪽수·직접 이동·처음/마지막·맨 위로(§paging) ──
    await click('[data-table-row="audit_logs"]')
    await page.waitForTimeout(1500)
    await page.locator('select').last().selectOption('25')
    await page.waitForTimeout(1500)
    const totalPages = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((s) => s.previousElementSibling?.textContent === '/')
      return el?.textContent?.trim()
    })
    check('Remote › Data: 총 쪽수가 숫자로 채워진다', /^\d+$/.test(totalPages ?? ''))
    const last = Number(totalPages)

    if (last > 1) {
      // 맨 위로 돌아오는지 보려면 먼저 굴려 내려가 있어야 한다.
      const scrollTop = () =>
        page.evaluate(() => {
          const g = [...document.querySelectorAll('div.overflow-auto')].find((d) => d.querySelector('table'))
          return g?.scrollTop ?? -1
        })
      await page.evaluate(() => {
        const g = [...document.querySelectorAll('div.overflow-auto')].find((d) => d.querySelector('table'))
        if (g) g.scrollTop = 200
      })
      await page.waitForTimeout(200)
      await pageInput().fill('2')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
      check('Remote › Data: 쪽 번호를 쳐서 곧장 이동한다', (await pageInput().inputValue()) === '2')
      check('Remote › Data: 쪽을 옮기면 표가 맨 위로 돌아온다', (await scrollTop()) === 0)

      await click('button[aria-label="마지막"]')
      await page.waitForTimeout(1500)
      check('Remote › Data: 마지막 쪽으로 한 번에 뛴다', (await pageInput().inputValue()) === String(last))
      await click('button[aria-label="처음"]')
      await page.waitForTimeout(1500)
      check('Remote › Data: 처음 쪽으로 한 번에 돌아온다', (await pageInput().inputValue()) === '1')

      await pageInput().fill('9999')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
      check('Remote › Data: 범위 밖 쪽 번호는 가장 가까운 쪽으로 당겨 잡는다', (await pageInput().inputValue()) === String(last))

      // ⭐ 회귀 — 쪽 번호는 표마다 기억하는데 쪽 크기는 전체가 하나를 쓴다. 마지막 쪽에 서
      // 있다가 다른 표에서 쪽 크기를 키우고 돌아오면 예전엔 **빈 표에 `9 / 2`** 가 떴다.
      await click('[data-table-row="users"]')
      await page.waitForTimeout(1200)
      await page.locator('select').last().selectOption('200')
      await page.waitForTimeout(1200)
      await click('[data-table-row="audit_logs"]')
      await page.waitForTimeout(2500)
      check('Remote › Data: 쪽 크기를 키운 뒤 돌아와도 빈 쪽에 서지 않는다', (await rows()) > 0)
      check('Remote › Data: 범위 밖이 된 쪽은 마지막 쪽으로 스스로 되돌아온다', Number(await pageInput().inputValue()) <= 2)
      await page.locator('select').last().selectOption('50') // 뒤 검사에 영향 없게 되돌린다
      await page.waitForTimeout(1000)
    } else {
      check(`Remote › Data: 쪽 이동 검사(테스트 DB audit_logs 가 25행 이하라 건너뜀 — 총 ${last}쪽)`, false)
    }
  }

  // ⭐ 표가 사라지면 그 표의 저장 필터도 사라진다(§data.saved-filter AC-5)
  {
    const conn = await page.evaluate(() => window.__rockuryNav.activeContext().conn ?? null)
    const run = (sql) => page.evaluate(([id, s]) => window.rockury.query.run(id, s), [conn, sql])

    await run('DROP TABLE IF EXISTS filter_probe')
    await run('CREATE TABLE filter_probe (id int primary key, note text)')
    await click('button:has-text("새로고침")')
    await page.waitForSelector('[data-table-row="filter_probe"]', { timeout: 15_000 })
    await click('[data-table-row="filter_probe"]')
    await page.waitForSelector('th:has-text("note")', { timeout: 10_000 })

    if ((await page.locator('[data-filter-toggle]').count()) === 0) await click('button:has-text("필터")')
    await page.waitForSelector('[data-filter-toggle]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.locator('input[placeholder="값"]').first().fill('x')
    await click('[data-save-filter]')
    await page.waitForSelector('input[placeholder="필터 이름"]', { timeout: 5_000 })
    await page.locator('input[placeholder="필터 이름"]').fill('probe 필터')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    const saved = await page.evaluate((id) => window.rockury.dataFilters.listByConnection(id), conn)
    check('Remote › Data: 표에 저장 필터가 붙었다', saved.some((s) => s.name === 'probe 필터'))

    // 표를 지우고 역설계를 다시 읽으면 그 표의 저장 필터가 정리된다.
    await run('DROP TABLE IF EXISTS filter_probe')
    await click('button:has-text("새로고침")')
    await page.waitForTimeout(2500)
    const after = await page.evaluate((id) => window.rockury.dataFilters.listByConnection(id), conn)
    check('Remote › Data: 표를 지우면 그 표의 저장 필터도 사라진다', !after.some((s) => s.name === 'probe 필터'))
    // 다른 표(users)의 저장 필터는 그대로 — 범위 안이라고 싸잡아 지우지 않는다.
    check('Remote › Data: 남아 있는 표의 저장 필터는 그대로다', after.some((s) => s.name === '메일에 a'))
  }

  // ⭐ CASE-remote-04O — 컬럼이 사라진 저장 필터는 빨갛게 막힌다(§data.saved-filter AC-4)
  {
    const conn = await page.evaluate(() => window.__rockuryNav.activeContext().conn ?? null)
    const run = (sql) => page.evaluate(([id, s]) => window.rockury.query.run(id, s), [conn, sql])

    await run('DROP TABLE IF EXISTS broken_probe')
    await run('CREATE TABLE broken_probe (id int primary key, nickname varchar(50), note text)')
    await run("INSERT INTO broken_probe VALUES (1, 'kim', 'hello')")
    await click('button:has-text("새로고침")')
    await page.waitForSelector('[data-table-row="broken_probe"]', { timeout: 15_000 })
    await page.waitForTimeout(600) // 목록이 막 그려진 직후의 클릭은 삼켜진다
    await click('[data-table-row="broken_probe"]')
    await page.waitForSelector('th:has-text("nickname")', { timeout: 15_000 })

    if ((await page.locator('[data-filter-toggle]').count()) === 0) await click('button:has-text("필터")')
    await page.waitForSelector('[data-filter-toggle]', { timeout: 5_000 })
    await page.waitForTimeout(400)

    // 컬럼 둘에 각각 저장 필터 — 하나는 곧 깨지고 하나는 멀쩡히 남는다.
    const pickColumn = async (col) => {
      await click('[data-search-select="filter-column"]')
      await page.waitForSelector('input[placeholder="컬럼 검색"]', { timeout: 5_000 })
      await page.locator('input[placeholder="컬럼 검색"]').fill(col)
      await page.waitForTimeout(250)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
    }
    const saveAs = async (name) => {
      await click('[data-save-filter]')
      await page.waitForSelector('input[placeholder="필터 이름"]', { timeout: 5_000 })
      await page.locator('input[placeholder="필터 이름"]').fill(name)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
    }
    await pickColumn('nickname')
    await page.locator('input[placeholder="값"]').first().fill('kim')
    await saveAs('별명이 kim')
    await pickColumn('note')
    await page.locator('input[placeholder="값"]').first().fill('hello')
    await saveAs('메모가 hello')

    // 밖에서 컬럼 하나를 지운다.
    await run('ALTER TABLE broken_probe DROP COLUMN nickname')
    await click('button:has-text("새로고침")')
    // 고정 대기가 아니라 **헤더에서 컬럼이 실제로 빠질 때까지** 기다린다.
    await page.waitForFunction(
      () => !document.querySelector('th')?.closest('table')?.innerText.includes('nickname'),
      null,
      { timeout: 20_000 }
    )
    await page.waitForTimeout(500)
    if ((await page.locator('[data-filter-toggle]').count()) === 0) await click('button:has-text("필터")')
    await page.waitForTimeout(400)
    await click('[data-saved-filters]')
    await page.waitForSelector('[data-saved-filter="별명이 kim"]', { timeout: 8_000 })

    const broken = page.locator('[data-saved-filter="별명이 kim"]')
    const intact = page.locator('[data-saved-filter="메모가 hello"]')
    const brokenText = await broken.innerText()
    check('Remote › Data: 컬럼이 사라진 저장 필터가 못 쓰는 상태로 표시된다', (await broken.getAttribute('data-saved-filter-broken')) !== null)
    check('Remote › Data: 멀쩡한 저장 필터는 그대로 쓸 수 있다', (await intact.getAttribute('data-saved-filter-broken')) === null)
    check('Remote › Data: 없어진 컬럼 이름과 이유를 밝힌다', brokenText.includes('nickname') && brokenText.includes('적용할 수 없습니다'))
    check('Remote › Data: 못 쓰는 저장 필터는 적용이 막힌다', await broken.locator('button').first().isDisabled())

    // 색 판정은 하네스의 `isRedFamily` 를 쓴다 — 표기가 rgb()/oklab() 둘이라 손으로 재면 틀린다.
    const colors = await page.evaluate(() => {
      const box = document.querySelector('[data-saved-filter-broken]')
      const warn = [...box.querySelectorAll('div')].find((d) => d.textContent.includes('적용할 수 없습니다'))
      return { warn: getComputedStyle(warn).color, border: getComputedStyle(box).borderColor }
    })
    check(
      'Remote › Data: 경고가 빨간 계열이다(글자·테두리)',
      isRedFamily(colors.warn) && isRedFamily(colors.border)
    )

    await page.keyboard.press('Escape')
    await run('DROP TABLE IF EXISTS broken_probe')
  }

  // ⭐ CASE-remote-04Q — 오삭제 회귀(§data.saved-filter AC-5a)
  //
  // "역설계 목록에 없다"에는 두 가지가 섞여 있다: 진짜 없는 것과 **표는 있는데 권한이 없어
  // 안 보이는 것**. 앞은 앞 블록(`filter_probe`, 전권 계정)이 "지워진다"로 덮었고, 여기서는
  // 뒤가 **살아남는지**를 본다 — 못 가르면 계정 권한이 바뀐 사이 사용자가 만든 필터가
  // 되돌릴 수 없이 날아간다. 그래서 목록만 믿지 않고 그 표에 직접 물어본다.
  //
  // 제한 권한 계정(`rky_limited`, `testdb.roles` 만 볼 수 있음)은 **테스트 DB 픽스처**가 심는다
  // (`npm run db:up`). 앱이 쓰는 `test` 계정엔 GRANT 권한이 없어 검사가 실행 중에 못 만든다.
  {
    const limitedId = await page.evaluate(async () => {
      const c = await window.rockury.connections.create({
        name: 'E2E-limited',
        dbType: 'mysql',
        host: '127.0.0.1',
        port: 13306,
        database: 'testdb',
        user: 'rky_limited',
        password: 'rky_limited',
        sslEnabled: false,
        autoCheckDisabled: true
      })
      // 저장 필터를 IPC 로 심는다 — 이 검사의 관심사는 정리 판정이지 저장 화면이 아니다.
      //   roles : 이 계정에 보인다        → 후보도 아니다
      //   users : 표는 있는데 권한이 없다 → 후보지만 **살아남아야** 한다(이 검사의 핵심)
      for (const t of ['roles', 'users']) {
        await window.rockury.dataFilters.save({
          connectionId: c.id,
          schema: 'testdb',
          table: t,
          name: `f:${t}`,
          filters: [{ column: 'id', op: '=', value: '1' }]
        })
      }
      return c.id
    })

    // IPC 로 만든 연결은 렌더러의 연결 목록이 아직 모른다 — 창을 다시 읽혀 목록을 맞춘다.
    await page.reload()
    await page.waitForSelector('text=Design', { timeout: 20_000 })
    await click('[data-nav-module="remote"]')
    await page.waitForTimeout(400)
    await page.evaluate((id) => window.__rockuryNav.setContextValue('conn', id), limitedId)
    await page.waitForTimeout(800)
    await click('button:has-text("Data")')
    await page.waitForSelector('[data-table-row="roles"]', { timeout: 20_000 })
    await page.waitForTimeout(4000) // 정리는 확인 질의를 거치므로 목록이 뜬 뒤에도 한 박자 더 걸린다

    const left = await page.evaluate((id) => window.rockury.dataFilters.listByConnection(id), limitedId)
    const has = (t) => left.some((s) => s.table === t)
    check('Remote › Data: 권한에 가려졌을 뿐인 표의 저장 필터는 살아남는다', has('users'))
    check('Remote › Data: 보이는 표의 저장 필터는 그대로다', has('roles'))

    // 뒷정리 — 뒤 스위트가 이 연결을 보지 않게 한다(연결을 지우면 그 저장 필터도 무의미해진다).
    await page.evaluate((id) => window.rockury.connections.delete(id), limitedId)
    const back = await page.evaluate(() => window.rockury.connections.list().then((l) => l[0].id))
    await page.evaluate((id) => window.__rockuryNav.setContextValue('conn', id), back)
    await page.waitForTimeout(600)
  }
}
