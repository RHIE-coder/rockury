// 스모크 스위트 — Console › Collection/History — 컬렉션 트리 DnD·Run All·실행 이력
// 실행: `npm run e2e`(e2e/smoke.mjs 러너가 순서대로 부른다). 단독 실행용 진입점은 없다.
// ⚠ 접근성 쿼리(getByRole 등)는 창을 크래시시킨다 → CSS/text 로케이터만.

export const meta = {
  name: '09-console-collection',
  needsDb: true,
  desc: 'Console › Collection/History — 컬렉션 트리 DnD·Run All·실행 이력'
}

export async function run(ctx) {
  const { check, click, body } = ctx
  let page = ctx.page
  // Console › Collection — 좌 컬렉션 트리 · 중앙 아이템 · 우 QUERIES(재설계)
  await click('button:has-text("Collection")')
  await page.waitForTimeout(400)
  await click('button[title="새 컬렉션"]')
  await page.waitForTimeout(500)
  check('Console › Collection: 컬렉션 생성', (await body()).includes('Untitled Collection'))

  // 우측 QUERIES → 중앙으로 드래그앤드롭해 참조 추가(hybrid, DnD) (T15)
  await page.locator('[draggable="true"]:has-text("Untitled Query")').first().dragTo(page.locator('[data-drop="collection-items"]'))
  await page.waitForTimeout(500)
  check('Console › Collection: QUERIES 드래그 → 참조 추가(참조 배지)', (await body()).includes('참조'))

  // ⭐ Run All (조회 전용 참조 1건) → 커밋 게이트 없이 자동 종료(읽기 전용 no-commit · 사용자 회귀)
  await click('button:has-text("Run All")')
  await page.waitForSelector('text=커밋 불필요', { timeout: 15_000 })
  check('Console › Collection: 조회 전용 Run-All 은 커밋 불필요(자동 종료)', (await body()).includes('커밋 불필요') && !(await body()).includes('아직 커밋되지'))
  // ⭐ 각 쿼리 결과를 인라인으로 펼쳐 본다(눈 아이콘) — 결과 표시 방법(사용자 요청)
  await click('button[title="결과 펼치기"]')
  await page.waitForSelector('button[title="결과 접기"]', { timeout: 8_000 })
  check('Console › Collection: 각 쿼리 결과 인라인 펼침', (await page.locator('button[title="결과 접기"]').count()) > 0)

  // 쓰기 아이템 추가 → Run All → 커밋 게이트(쓰기 원자성) → 롤백
  await page.locator('input[placeholder="즉석 이름"]').fill('WRITE_ITEM')
  await page.locator('input[placeholder^="즉석 SELECT"]').fill('UPDATE users SET is_active = is_active')
  await click('button:has-text("추가")')
  await page.waitForTimeout(400)
  await click('button:has-text("Run All")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: 쓰기 포함 Run-All 은 커밋 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Console › Collection: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 쓰기 아이템 개별 실행 — 커밋되지 않고 트랜잭션에 쌓임(원자성 유지) → 커밋
  await page.locator('button[title^="이 아이템만 실행"]').last().click()
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: 쓰기 아이템 개별 실행 → 미커밋(원자성)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("커밋")')
  await page.waitForTimeout(300)
  check('Console › Collection: 개별 실행 커밋 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // ⭐ 컬렉션 트리 DnD — 루트 아이템을 "펼친 폴더의 첫 자식" 위로 끌 때: 수직(dx=0)이면 루트
  //    유지, 오른쪽(dx>0)이면 그 폴더로 중첩. (사용자 회귀: 루트로 못 가고 폴더로만 잡히던 버그)
  const treeIds = await page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const fa = await window.rockury.collections.createFolder({ connectionId: cid, parentId: null, name: 'TREE_FOLDER' })
    await window.rockury.collections.create({ connectionId: cid, name: 'TREE_CHILD', folderId: fa.id })
    const move = await window.rockury.collections.create({ connectionId: cid, name: 'TREE_MOVE', folderId: null })
    return { cid, faId: fa.id, moveId: move.id }
  })
  const remountColl = async (waitText = 'TREE_MOVE') => { await click('button:has-text("Query")'); await click('button:has-text("Collection")'); await page.waitForSelector(`text=${waitText}`, { timeout: 8_000 }) }
  const rowHandle = async (name) => await page.locator(`div.group\\/row:has-text("${name}")`).first().locator('span').first().boundingBox()
  const rowBox = async (name) => await page.locator(`div.group\\/row:has-text("${name}")`).first().boundingBox()
  const folderOf = async (id) => ((await page.evaluate(async (cid) => await window.rockury.collections.list(cid), treeIds.cid)).find((c) => c.id === id) || {}).folderId
  // dnd-kit PointerSensor 드래그: 핸들 잡고 → 세로로 목표 행까지(가로 오프셋 dx 고정) → 놓기
  const dragTree = async (fromName, toName, dx) => {
    const from = await rowHandle(fromName), to = await rowBox(toName)
    const sx = from.x + from.width / 2, sy = from.y + from.height / 2, ty = to.y + to.height / 2
    await page.mouse.move(sx, sy); await page.mouse.down()
    await page.mouse.move(sx + dx, sy + 6, { steps: 3 }) // 활성화(activationConstraint distance:4 초과)
    await page.mouse.move(sx + dx, ty, { steps: 12 })
    await page.mouse.move(sx + dx, ty, { steps: 2 })
    await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(500)
  }
  await remountColl()
  await dragTree('TREE_MOVE', 'TREE_CHILD', 0)
  check('Console › Collection: 트리 DnD 수직 드래그=루트 유지(folderId null)', (await folderOf(treeIds.moveId)) == null)
  await remountColl()
  await dragTree('TREE_MOVE', 'TREE_CHILD', 22)
  check('Console › Collection: 트리 DnD 오른쪽 드래그=폴더로 중첩(양성 대조)', (await folderOf(treeIds.moveId)) === treeIds.faId)

  // 폴더 "아이콘" 클릭으로 펼치기/접기 (사용자 회귀: 아이콘 클릭이 안 먹던 문제 — 이름만 토글됐음)
  const iconClick = async (name) => { const b = await rowHandle(name); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300) }
  const colHasRow = async (name) => (await page.locator('aside').first().locator(`button:has-text("${name}")`).count()) > 0
  const colRowNames = async () => await page.evaluate(() => [...document.querySelector('aside').querySelectorAll('div.group\\/row')].map((d) => d.querySelector('button')?.textContent.trim()))
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
  const ax = await page.evaluate(async (cid) => {
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
  await page.locator('div.group\\/row:has-text("AXDROP")').first().locator('button[title="이름 변경"]').click()
  await page.waitForTimeout(200)
  await page.locator('aside').first().locator('input:not([placeholder])').first().fill('AXRENAMED')
  await page.keyboard.press('Enter'); await page.waitForTimeout(500)
  check('Console › Collection: 연필 버튼으로 컬렉션 이름 변경 저장', await page.evaluate(async (cid) => (await window.rockury.collections.list(cid)).some((c) => c.name === 'AXRENAMED'), treeIds.cid))

  // 우클릭 컨텍스트 메뉴 + 이동 ▶ 서브메뉴 (Query/Collection 구조 편집 통합)
  const mv = await page.evaluate(async (cid) => {
    const F = await window.rockury.collections.createFolder({ connectionId: cid, parentId: null, name: 'CTXDEST' })
    const c = await window.rockury.collections.create({ connectionId: cid, name: 'CTXMOVE', folderId: null })
    return { destId: F.id, moveId: c.id }
  }, treeIds.cid)
  await remountColl('CTXMOVE')
  await page.locator('div.group\\/row:has-text("CTXMOVE")').first().click({ button: 'right' })
  await page.waitForTimeout(250)
  check('Console › Collection: 우클릭 컨텍스트 메뉴 등장', await page.locator('button:has-text("이동")').count() > 0)
  // ⭐ 바깥 클릭/Esc 로 닫힌다 (사용자 회귀: 다른 화면 눌러도 안 닫힘)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Console › Collection: 컨텍스트 메뉴 Esc 로 닫힘', await page.locator('button:has-text("이동")').count() === 0)
  await page.locator('div.group\\/row:has-text("CTXMOVE")').first().click({ button: 'right' })
  await page.waitForTimeout(250)
  await page.locator('button:has-text("이동")').first().click()
  await page.waitForTimeout(200)
  await page.locator('.absolute button:has-text("CTXDEST")').first().click() // 이동 서브메뉴의 대상 폴더
  await page.waitForTimeout(500)
  check('Console › Collection: 컨텍스트 이동▶서브메뉴로 폴더 이동', (await folderOf(mv.moveId)) === mv.destId)

  // 컬렉션 설명(description) 편집 저장 (Query 와 동일한 상세 편집)
  await page.locator('aside').first().locator('button:has-text("CTXMOVE")').first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="설명 추가..."]').first().fill('설명123')
  await page.keyboard.press('Tab'); await page.waitForTimeout(500)
  check('Console › Collection: 설명(description) 편집 저장', await page.evaluate(async (cid) => (await window.rockury.collections.list(cid)).some((c) => c.description === '설명123'), treeIds.cid))

  // Console › History — 독립 뷰(다중 소스): Query 실행 이력이 기록됨
  await click('button:has-text("History")')
  await page.waitForSelector('text=Source', { timeout: 8_000 })
  await page.waitForTimeout(300)
  check('Console › History: 실행 이력 기록(Query SQL)', (await body()).includes('SELECT id, email FROM users'))

  // ⭐ History 누적 — 같은 SQL 을 여러 번 실행하면 실행 횟수만큼 쌓인다(사용자 회귀: 안 쌓이고 1행만).
  const histCount = await page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const sql = 'SELECT 42 AS hist_probe'
    for (let i = 0; i < 3; i++) await window.rockury.query.historyAppend({ connectionId: cid, source: 'query', sql, kind: 'read', status: 'success', rowCount: 1 })
    const list = await window.rockury.query.historyList(cid)
    return list.filter((r) => r.sql === sql).length
  })
  check('Console › History: 같은 SQL 3번 실행 = 3행(중복 접기 없음)', histCount === 3)

  // ⭐ 컬렉션 로그 그룹(아코디언) — 조회 2건 컬렉션을 Run All → History 에서 컬렉션 이름·문 수 그룹, 펼치면 #순번.
  await page.evaluate(async () => {
    const cid = (await window.rockury.connections.list())[0].id
    const c = await window.rockury.collections.create({ connectionId: cid, name: 'GRP_COLL', folderId: null })
    await window.rockury.collections.addItem({ collectionId: c.id, name: 'g1', sql: 'SELECT 1 AS a' })
    await window.rockury.collections.addItem({ collectionId: c.id, name: 'g2', sql: 'SELECT 2 AS b' })
  })
  await click('button:has-text("Collection")')
  await page.waitForSelector('text=GRP_COLL', { timeout: 8_000 })
  await page.locator('aside').first().locator('button:has-text("GRP_COLL")').first().click()
  await page.waitForTimeout(300)
  await click('button:has-text("Run All")')
  await page.waitForSelector('text=커밋 불필요', { timeout: 15_000 })
  await click('button:has-text("History")')
  await page.waitForSelector('text=Source', { timeout: 8_000 })
  await page.waitForTimeout(300)
  check('Console › History: 컬렉션 실행 그룹(GRP_COLL · 2개 쿼리)', (await body()).includes('GRP_COLL') && (await body()).includes('2개 쿼리'))
  await page.locator('tr:has-text("GRP_COLL")').first().click() // 그룹 펼치기
  await page.waitForTimeout(250)
  check('Console › History: 그룹 펼치면 컬렉션 내 순번(#1/#2)', (await body()).includes('#1') && (await body()).includes('#2'))

}
