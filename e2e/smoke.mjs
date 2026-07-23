// 빌드된 Rockury 앱 구동 스모크 — 설계 선택 → Definition → 버전 컷 → 운영부(Console/Migration).
// 주의: getByRole 계열은 이 창을 크래시시킴 → CSS/text 로케이터만 사용.
// 운영부 섹션(연결 테스트)은 test-db(mysql:13306)가 떠 있어야 한다 → `npm run db:up`.
// ⚠ 이 스모크는 **실 앱 DB(userData)를 절대 건드리지 않는다** — 격리된 임시 userData 로
//    앱을 띄우고(--user-data-dir), 종료 시 그 임시 디렉터리만 지운다. (e2e/isolation.test.ts 가 강제)
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// playwright-core 는 앱 node_modules 에서 해석(디렉터리 무관하게 안전)
const require = createRequire(path.join(APP, 'package.json'))
const electronBin = path.join(
  APP,
  process.platform === 'darwin'
    ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    : 'node_modules/electron/dist/electron'
)
const MAIN = path.join(APP, 'out/main/index.js')
// 격리된 임시 userData — 실 앱 DB 를 건드리지 않는 clean 시드.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rockury-e2e-'))

if (!fs.existsSync(MAIN)) {
  console.error('먼저 `npm run build` 를 실행하세요 (out/main/index.js 없음).')
  process.exit(1)
}

let pass = true
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label)
  if (!cond) pass = false
}

const launch = () =>
  electron.launch({ executablePath: electronBin, args: [MAIN, `--user-data-dir=${USER_DATA}`], timeout: 30_000 })
let app = await launch()
let page = await app.firstWindow()
// 미저장 변경 가드 등 window.confirm 은 자동 수락(사용자가 "예"를 누른 것으로).
const acceptDialogs = (p) => p.on('dialog', (d) => d.accept().catch(() => {}))
acceptDialogs(page)
const click = (sel) => page.locator(sel).first().click()
const body = () => page.evaluate(() => document.body.innerText)
// CodeMirror(.cm-content)에 SQL 입력 — 전체선택→삭제→타이핑→자동완성 팝업 닫기.
const typeSql = async (text) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}

try {
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  check('앱 부팅 + DB 서비스 셸 렌더', (await body()).includes('Studio'))

  // 설계 선택
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await page.waitForTimeout(300)

  // Studio › Definition — 시드 테이블
  await click('button:has-text("Studio")')
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=orders', { timeout: 5_000 })
  check('Definition: 시드 테이블(orders) 표시', (await body()).includes('orders'))

  // Studio › Diagram — 가상 ERD 편집기(설계 테이블 렌더 + 편집 + 설계 스코프 위치 영속).
  await click('button:has-text("Diagram")')
  await page.waitForSelector('.react-flow__node[data-id]', { timeout: 10_000 })
  await page.waitForTimeout(300)
  check('Studio › Diagram: 설계 ERD 노드 렌더(orders)', (await page.locator('.react-flow__node[data-id]').count()) > 0 && (await body()).includes('orders'))
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
    const nd = page.locator('.react-flow__node[data-id]').last()
    const box = await nd.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + 8 + 90, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const saved = await page.evaluate(async () => {
      const l = await window.rockury.diagram.getLayout('design:commerce-core')
      return l && l.positions ? Object.keys(l.positions).length : 0
    })
    check('Studio › Diagram: 드래그 → 설계 레이아웃 저장', saved > 0)
  }
  // Definition 으로 복귀(이후 흐름 원복)
  await click('button:has-text("Definition")')
  await page.waitForTimeout(200)

  // Versions › Timeline — 시드 버전
  await click('button:has-text("Versions")')
  await page.waitForSelector('text=버전 타임라인', { timeout: 5_000 })
  await page.waitForTimeout(300)
  const tl = await body()
  check('Timeline: 시드 버전 v0.3.14 표시', tl.includes('v0.3.14'))

  // 버전 컷 (Patch → v0.3.15)
  await click('button:has-text("버전 컷")')
  await page.waitForSelector('text=증가 유형', { timeout: 5_000 })
  await click('button[aria-pressed]:has-text("Patch")')
  await click('button[type="submit"]')
  await page.waitForTimeout(500)
  check('버전 컷 후 v0.3.15 등장', (await body()).includes('v0.3.15'))

  // ── 운영부: Connection(1급) 생성 + mysql test-db 연결 테스트 (설계 불필요) ──
  await click('button:has-text("Connections")')
  await page.waitForTimeout(300)
  await click('button:has-text("새 연결")')
  await page.waitForSelector('text=연결 이름', { timeout: 5_000 })
  await page.locator('input[placeholder*="운영 DB"]').fill('E2E-mysql')
  await page.locator('input[placeholder="3306"]').fill('13306') // test-db mysql 포트 (기본 벤더 mysql)
  await page.locator('input[placeholder="testdb"]').fill('testdb')
  await page.locator('input[placeholder="test"]').fill('test')
  await page.locator('input[type="password"]').fill('test')
  await click('button:has-text("연결 테스트")')
  await page.waitForSelector('text=연결 성공', { timeout: 15_000 })
  check('Connections: mysql test-db 연결 성공(serverVersion)', (await body()).includes('연결 성공'))
  await click('button[type="submit"]:has-text("연결 만들기")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 5_000 })
  check('연결 카드(E2E-mysql) 생성', (await body()).includes('E2E-mysql'))

  // 카드 클릭 → active Connection → Console › Object 로 실 DB 역설계(Phase 2a)
  await click('div[role="button"]:has-text("E2E-mysql")')
  await page.waitForTimeout(200)
  await click('button:has-text("Console")')
  await click('button:has-text("Object")')
  await page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const obj = await body()
  check('Console › Object: 실 DB 역설계(users/user_roles)', obj.includes('users') && obj.includes('user_roles'))

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
    const box = await nd.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + 8 + 110, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500) // onNodeDragStop → saveLayout(IPC)
    const dragged = await nodeTf('t:users')
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

  // 내보내기 — PNG 클릭 → html-to-image 캡처 성공(toolbar data-export-status=ok).
  // (Electron 에선 data-URL 다운로드 이벤트가 Playwright 로 안 잡혀, 캡처 성공 여부를 상태로 검증.)
  await page.locator('.react-flow__panel button:has-text("PNG")').first().click()
  await page.waitForSelector('[data-export-status="ok"]', { timeout: 15_000 })
  check('Console › Diagram: PNG 내보내기(html-to-image 캡처 성공)', (await page.locator('[data-export-status="ok"]').count()) > 0)

  // Console › Definition — 같은 introspection TableDef[] 를 Studio Definition 형태(목록 | 상세/DDL)로. 읽기 전용.
  await click('button:has-text("Definition")')
  await page.waitForSelector('text=user_roles', { timeout: 15_000 })
  const defBody = await body()
  check(
    'Console › Definition: 사이드바 실 DB 테이블 목록(users/user_roles)',
    defBody.includes('users') && defBody.includes('user_roles')
  )
  // 사이드바에서 테이블 선택 → SQL(DDL) 뷰 토글 → 실 introspection + generateDdl 로 CREATE 문 렌더.
  // NOTE: 토글은 :text-is 로 정확 일치 — has-text 는 ContextBar 의 "MySQL" 버튼까지 잡는다.
  await page.locator('li button:has-text("user_roles")').first().click()
  await page.waitForTimeout(200)
  await click('button:text-is("SQL")')
  await page.waitForSelector('text=CREATE TABLE', { timeout: 10_000 })
  const ddlBody = await body()
  check(
    'Console › Definition: SQL 뷰 DDL(CREATE TABLE user_roles) 렌더',
    ddlBody.includes('CREATE TABLE') && ddlBody.includes('user_roles')
  )
  await click('button:text-is("Table")') // Table 폼으로 복귀
  await page.waitForTimeout(150)

  // Console › Query — 저장쿼리 객체 트리 + 편집기(재설계). 새 쿼리 생성 → SELECT 실행.
  await click('button:has-text("Query")')
  await page.waitForSelector('.cm-content', { timeout: 15_000 })
  await click('button[title="새 쿼리"]')
  await page.waitForTimeout(400)
  // 구조 편집 통합: Query 트리 행에도 호버 편집(연필)/삭제 아이콘이 있어야 한다(Collection 과 동일).
  {
    const qrow = page.locator('div.group\\/row:has-text("Untitled Query")').first()
    check('Console › Query: 트리 행 이름변경(연필)+삭제 아이콘', (await qrow.locator('button[title="이름 변경"]').count()) > 0 && (await qrow.locator('button[title="삭제"]').count()) > 0)
  }
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await click('button:has-text("Run")')
  await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Console › Query: SELECT 결과 그리드', (await body()).includes('email'))
  await page.waitForTimeout(1200) // 자동저장(라이브러리 쿼리에 SQL 반영)

  // EXPLAIN — 실행 계획(실제 반영 없음)
  await click('button[title="실행 계획(EXPLAIN)"]')
  await page.waitForSelector('text=실행 계획', { timeout: 15_000 })
  check('Console › Query: EXPLAIN 실행 계획', (await body()).includes('실행 계획'))

  // 스키마 사이드 패널(기본 열림) — 테이블/컬럼 트리 (T12)
  check('Console › Query: 스키마 패널(user_roles)', (await body()).includes('user_roles'))

  // 파라미터화 쿼리 — {{키워드}} 입력 시 파라미터 바 노출 (T11)
  await typeSql('SELECT * FROM users WHERE id = {{uid}}')
  await page.waitForTimeout(300)
  check('Console › Query: {{키워드}} 파라미터 바', (await body()).includes('파라미터'))

  // ⭐ 파괴적 트랜잭션 게이트 — WHERE 없는 UPDATE → 커밋 대기 바 → 롤백
  await typeSql('UPDATE users SET is_active = is_active')
  await click('button:has-text("Run")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Query: DML 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Console › Query: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 저장쿼리 SQL 을 깨끗한 SELECT 로 복원(자동저장) — Collection 참조 실행용
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await page.waitForTimeout(1200)

  // Console › Data — 조회 + 편집(수정→트랜잭션 게이트→롤백)(Phase 2b)
  await click('button:has-text("Data")')
  await page.waitForSelector('aside button:has-text("users")', { timeout: 15_000 })
  await click('aside button:has-text("users")')
  await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Console › Data: users 행 조회', (await body()).includes('email'))

  // 컬럼 정렬(ORDER BY — 파라미터 바인드 SELECT 재조회)
  await click('th button:has-text("email")')
  await page.waitForTimeout(500)
  check('Console › Data: 컬럼 정렬 재조회', (await body()).includes('email'))

  // ⭐ 툴바 드롭다운(타임존)은 바깥 클릭/Esc 로 닫힌다 (사용자 회귀: 다른 곳 눌러도 안 닫힘)
  await click('button[title^="날짜 표시"]')
  await page.waitForSelector('text="LOCAL"', { timeout: 5_000 })
  check('Console › Data: 타임존 드롭다운 열림', (await page.locator('text="LOCAL"').count()) > 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Console › Data: 타임존 드롭다운 Esc 로 닫힘', (await page.locator('text="LOCAL"').count()) === 0)

  // 첫 행 first_name(2번째 입력) 수정 → 저장 → 게이트 → 롤백
  await page.locator('tbody tr').first().locator('input').nth(1).fill('E2E-edit')
  await page.waitForSelector('button:has-text("저장")', { timeout: 5_000 })
  await click('button:has-text("저장")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Data: 편집 트랜잭션 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Console › Data: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 키 배지(PK/FK/UK 텍스트) + 타입 라벨(char/varchar) (T1)
  check('Console › Data: 키 배지(PK)+타입 라벨', (await body()).includes('PK'))
  // Constraints 탭 — 전역 제약 목록(읽기 전용) (T10)
  await click('button:has-text("Constraints")')
  await page.waitForTimeout(500)
  check('Console › Data: Constraints 탭 제약 목록(PRIMARY)', (await body()).includes('PRIMARY'))
  await click('button:has-text("Tables")')
  await page.waitForTimeout(200)

  // FK 참조 선택 모달 — FK 셀의 FK 버튼 클릭 → 모달(검색·페이지·Set NULL/Cancel/Apply) (사용자 보고 회귀 방지)
  await click('aside button:has-text("user_roles")')
  await page.waitForSelector('tbody tr', { timeout: 15_000 })
  await page.waitForTimeout(300)
  await click('button[title$="참조 선택"]')
  await page.waitForSelector('button:has-text("Set NULL")', { timeout: 8_000 })
  check('Console › Data: FK 참조 선택 모달 열림', (await body()).includes('참조 선택'))
  await click('button:has-text("Cancel")')
  await page.waitForTimeout(200)

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

  // Migration › Drift — 기준선 캡처 → 드리프트 없음(Phase 3a/3b · diff② 재사용)
  await click('button:has-text("Migration")')
  await click('button:has-text("Drift")')
  await page.waitForSelector('text=기준선이 없습니다', { timeout: 15_000 })
  await click('button:has-text("기준선으로 캡처")')
  await page.waitForSelector('text=드리프트 없음', { timeout: 15_000 })
  check('Migration › Drift: 기준선 캡처 후 드리프트 없음', (await body()).includes('드리프트 없음'))

  // Migration › Logs — 기준선 로그 기록(Phase 3e)
  await click('button:has-text("Logs")')
  await page.waitForSelector('text=기준선', { timeout: 8_000 })
  check('Migration › Logs: 기준선 로그 체인', (await body()).includes('기준선'))

  // ⭐ 콜드 재시작(프로세스 종료→재기동, 같은 userData) 후 연결 잔존 — 진짜 영속 검증.
  //    (renderer reload 가 아니라 실제 앱을 껐다 켠다. 사용자가 겪은 시나리오.)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  acceptDialogs(page)
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await click('button:has-text("Connections")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  check('콜드 재시작 후 연결 잔존(SQLite 영속)', (await body()).includes('E2E-mysql'))

  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
} catch (e) {
  console.error('SMOKE FAIL:', e.message.split('\n')[0])
  pass = false
} finally {
  await app.close().catch(() => {})
  fs.rmSync(USER_DATA, { recursive: true, force: true }) // 임시 userData 만 정리(실 DB 무관)
}
process.exit(pass ? 0 : 1)
