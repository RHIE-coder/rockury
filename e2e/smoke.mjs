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

  // Console › Query — 저장쿼리 객체 트리 + 편집기(재설계). 새 쿼리 생성 → SELECT 실행.
  await click('button:has-text("Query")')
  await page.waitForSelector('.cm-content', { timeout: 15_000 })
  await click('button[title="새 쿼리"]')
  await page.waitForTimeout(400)
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

  // 우측 QUERIES 에서 저장쿼리를 참조로 추가(hybrid) (T15)
  await page.locator('button[title="이 컬렉션에 참조로 추가"]').first().click()
  await page.waitForTimeout(500)
  check('Console › Collection: QUERIES 에서 참조 추가(참조 배지)', (await body()).includes('참조'))

  // Run All → 트랜잭션 게이트 → 커밋
  await click('button:has-text("Run All")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: Run-All 트랜잭션 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("커밋")')
  await page.waitForTimeout(300)
  check('Console › Collection: 커밋 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 아이템 하나씩 실행 — 개별 실행이지만 커밋되지 않고 트랜잭션에 쌓임(원자성 유지)
  await page.locator('button[title^="이 아이템만 실행"]').first().click()
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: 아이템 개별 실행 → 미커밋(원자성)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("커밋")')
  await page.waitForTimeout(300)
  check('Console › Collection: 개별 실행 커밋 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // Console › History — 독립 뷰(다중 소스): Query 실행 이력이 기록됨
  await click('button:has-text("History")')
  await page.waitForSelector('text=Source', { timeout: 8_000 })
  await page.waitForTimeout(300)
  check('Console › History: 실행 이력 기록(Query SQL)', (await body()).includes('SELECT id, email FROM users'))

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
