// 빌드된 Rockury 앱 구동 스모크 — 설계 선택 → Definition → 버전 컷 → 운영부 Environments.
// 주의: getByRole 계열은 이 창을 크래시시킴 → CSS/text 로케이터만 사용.
// 운영부 섹션(Environments 연결 테스트)은 test-db(mysql:13306)가 떠 있어야 한다 → `npm run db:up`.
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

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
const DB = path.join(homedir(), 'Library/Application Support/Rockury/rockury.db')

if (!fs.existsSync(MAIN)) {
  console.error('먼저 `npm run build` 를 실행하세요 (out/main/index.js 없음).')
  process.exit(1)
}
for (const f of [DB, DB + '-wal', DB + '-shm']) if (fs.existsSync(f)) fs.rmSync(f)

let pass = true
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label)
  if (!cond) pass = false
}

const app = await electron.launch({ executablePath: electronBin, args: [MAIN], timeout: 30_000 })
const page = await app.firstWindow()
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

  // Console › Query — CodeMirror 에디터로 SELECT 실행(Phase 2c + 향상)
  await click('button:has-text("Query")')
  await page.waitForSelector('.cm-content', { timeout: 5_000 })
  await typeSql('SELECT id, email FROM users LIMIT 3')
  await click('button:has-text("실행")')
  await page.waitForSelector('th:has-text("email")', { timeout: 15_000 })
  check('Console › Query: SELECT 결과 그리드', (await body()).includes('email'))

  // 라이브러리에 저장(Collection 트리에서 확인)
  await click('button:has-text("저장")')
  await page.waitForTimeout(200)

  // EXPLAIN — 실행 계획(실제 반영 없음)
  await click('button:has-text("EXPLAIN")')
  await page.waitForSelector('text=실행 계획', { timeout: 15_000 })
  check('Console › Query: EXPLAIN 실행 계획', (await body()).includes('실행 계획'))

  // ⭐ 파괴적 트랜잭션 게이트 — WHERE 없는 UPDATE → 커밋 대기 바 → 롤백
  await typeSql('UPDATE users SET is_active = is_active')
  await click('button:has-text("실행")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Query: DML 트랜잭션 게이트(커밋 대기)', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("롤백")')
  await page.waitForTimeout(300)
  check('Console › Query: 롤백 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

  // 히스토리 — 실행한 SELECT 가 기록됨
  await click('button:has-text("히스토리")')
  await page.waitForTimeout(300)
  check('Console › Query: 히스토리 기록', (await body()).includes('SELECT id, email FROM users'))
  await click('button:has-text("히스토리")')

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

  // Console › Collection — 저장쿼리 라이브러리 + 컬렉션 Run-All(트랜잭션)
  await click('button:has-text("Collection")')
  await page.waitForTimeout(400)
  check('Console › Collection: 저장 쿼리 라이브러리', (await body()).includes('SELECT id, email FROM users'))
  await click('button[title="새 컬렉션"]')
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="이름"]').fill('ping')
  await page.locator('input[placeholder*="SELECT"]').fill('SELECT 1')
  await click('button:has-text("추가")')
  await page.waitForTimeout(200)
  check('Console › Collection: 아이템 추가', (await body()).includes('ping'))
  await click('button:has-text("Run All")')
  await page.waitForSelector('text=아직 커밋되지', { timeout: 15_000 })
  check('Console › Collection: Run-All 트랜잭션 게이트', (await body()).includes('아직 커밋되지'))
  await click('button:has-text("커밋")')
  await page.waitForTimeout(300)
  check('Console › Collection: 커밋 후 게이트 해제', !(await body()).includes('아직 커밋되지'))

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

  // 재시작(reload) 후 연결 잔존 — SQLite 영속(연결은 설계 무관 전역)
  await page.reload()
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await click('button:has-text("Connections")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  check('재시작 후 연결 잔존(SQLite 영속)', (await body()).includes('E2E-mysql'))

  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
} catch (e) {
  console.error('SMOKE FAIL:', e.message.split('\n')[0])
  pass = false
} finally {
  await app.close().catch(() => {})
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (fs.existsSync(f)) fs.rmSync(f)
}
process.exit(pass ? 0 : 1)
