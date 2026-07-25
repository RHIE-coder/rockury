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
  electron.launch({
    executablePath: electronBin,
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    // MCP 포트 0 = OS 배정 — 개발 앱(기본 41729)과 충돌 없이 격리 구동. 실제 주소는 상태 IPC 로 확인.
    env: { ...process.env, ROCKURY_MCP_PORT: '0' },
    timeout: 30_000
  })
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

  // ── MCP 서버(메인 프로세스 내장) — 상태 IPC → initialize → tools/list → tools/call + 인증 거부 ──
  {
    // 접속 정보 파일을 디스크에 만들지 않는다 — 주소·키는 앱 상태 IPC 로만 얻는다.
    check('MCP: 접속 정보 파일(mcp.json) 미생성', !fs.existsSync(path.join(USER_DATA, 'mcp.json')))
    const mcpStatus = await page.evaluate(() => window.rockury.mcp.status())
    const mcp = { url: mcpStatus.url, token: mcpStatus.token }
    check('MCP: 상태 IPC — 실행 중 + 키 제공', mcpStatus.running === true && !!mcp.token)
    const mcpHeaders = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcp.token}`
    }
    const mcpPost = (bodyObj, sid) =>
      fetch(mcp.url, {
        method: 'POST',
        headers: { ...mcpHeaders, ...(sid ? { 'mcp-session-id': sid } : {}) },
        body: JSON.stringify(bodyObj)
      })
    const initRes = await mcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } }
    })
    const sid = initRes.headers.get('mcp-session-id')
    const init = await initRes.json()
    check('MCP: initialize(serverInfo=rockury) + 세션 발급', init?.result?.serverInfo?.name === 'rockury' && !!sid)
    await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
    const toolNames = (await (await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json())
      .result.tools.map((t) => t.name)
    check('MCP: tools/list 읽기 도구 노출', ['list_designs', 'get_schema', 'list_versions', 'get_version'].every((n) => toolNames.includes(n)))
    const ld = await (await mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_designs', arguments: {} } }, sid)).json()
    check('MCP: list_designs → 시드 설계(commerce-core)', ld?.result?.content?.[0]?.text?.includes('commerce-core') === true)
    const noAuth = await fetch(mcp.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: mcpHeaders.accept },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })
    })
    check('MCP: 무토큰 요청 거부(401)', noAuth.status === 401)
  }

  // ── AI › Agents 화면 — 게이트웨이 상태(초록불) + 접속 키 마스킹/재발급 실 흐름 ──
  {
    await click('[data-nav-service="mcp"]')
    await page.waitForSelector('text=에이전트 게이트웨이', { timeout: 5_000 })
    check('AI 화면: 게이트웨이 열림 표시', (await body()).includes('에이전트 게이트웨이 열림'))
    const st1 = await page.evaluate(() => window.rockury.mcp.status())
    check('AI 화면: 등록 명령 생성(Claude/Codex, url 포함)',
      st1.claudeCommand?.includes(st1.url) === true && st1.codexCommand?.includes(st1.url) === true)
    // 접속 키는 기본 마스킹 — 전체 값이 화면 텍스트에 노출되지 않는다
    check('AI 화면: 접속 키 기본 마스킹', !(await body()).includes(st1.token) && (await body()).includes(st1.token.slice(-4)))
    // 재발급 실 흐름 — 확인 단계 → 진행 → 구 키 즉시 401, 새 키 발급
    await click('button:has-text("재발급")')
    await page.waitForSelector('text=다시 등록해야 해요', { timeout: 3_000 })
    await click('button:has-text("재발급 진행")')
    await page.waitForTimeout(500)
    const st2 = await page.evaluate(() => window.rockury.mcp.status())
    check('재발급: 키 교체됨', !!st2.token && st2.token !== st1.token)
    const oldKeyRes = await fetch(st2.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${st1.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/list' })
    })
    check('재발급: 구 키 즉시 무효(401)', oldKeyRes.status === 401)
    const newKeyInit = await fetch(st2.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${st2.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-rotate', version: '0' } } })
    })
    check('재발급: 새 키로 접속 성공', (await newKeyInit.json())?.result?.serverInfo?.name === 'rockury')

    // 재등록 안내(접속 키가 바뀐 뒤) — 재발급 직후 화면에 재등록 명령이 뜨고, 명령이 새 키를 담는다.
    const afterBody = await body()
    check('재등록: 재발급 직후 안내 노출(다시 등록하세요 + 재등록 복사 버튼)',
      afterBody.includes('다시 등록') && afterBody.includes('재등록 복사'))
    check('재등록: "접속 키를 바꾼 뒤" 상시 안내 노출', afterBody.includes('접속 키를 바꾼 뒤'))
    check('재등록: claude 명령이 remove→add + 새 키를 담는다',
      st2.claudeReregisterCommand?.includes('claude mcp remove rockury') === true &&
      st2.claudeReregisterCommand?.includes(`Bearer ${st2.token}`) === true)
    check('재등록: codex 명령이 remove + 새 키(env)를 담는다',
      st2.codexReregisterCommand?.includes('codex mcp remove rockury') === true &&
      st2.codexReregisterCommand?.includes(`ROCKURY_MCP_TOKEN=${st2.token}`) === true)

    await click('[data-nav-service="db"]') // 후속 DB 흐름을 위해 복귀
    await page.waitForTimeout(300)
  }

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
  // ── Studio › Seed — 시드 세트 저작(선언 → 행 → 변수). CASE-studio-040~044 (docs/qa/db-studio.md) ──
  {
    await click('button:has-text("Seed")')
    await page.waitForSelector('text=아직 시드 세트가 없어요', { timeout: 8_000 })
    check('Studio › Seed: 세트 없을 때 빈 상태 CTA', (await body()).includes('테이블에서 시드 세트 만들기'))

    // 테이블 고르기 — orders 의 PK 는 AUTO_INCREMENT 라 자연키 기본값이 비어야 한다(사람이 고름).
    await click('button:has-text("테이블에서 시드 세트 만들기")')
    await page.waitForSelector('[data-seed-candidate]', { timeout: 8_000 })
    check('Studio › Seed: 등록 후보에 뷰가 없다', (await page.locator('[data-seed-candidate="v_active_products"]').count()) === 0)
    await click('[data-seed-candidate="orders"]')
    await page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
    check('Studio › Seed: 세트 등록(orders)', (await page.locator('[data-seed-set-row="orders"]').count()) === 1)
    check('Studio › Seed: 자동증가 PK → 자연키 경고', (await page.locator('[data-seed-needs-key]').count()) === 1)

    // 자연키 지정 → 경고 해제
    await click('[data-seed-key-toggle="order_number"]')
    await page.waitForTimeout(300)
    check('Studio › Seed: 자연키 지정 → 경고 해제', (await page.locator('[data-seed-needs-key]').count()) === 0)

    // 무시 컬럼 지정(비교 소음 제거)
    await click('[data-seed-ignore-toggle="ordered_at"]')
    await page.waitForTimeout(200)
    check('Studio › Seed: 무시 컬럼 지정 표시', (await body()).includes('무시'))

    // 행 추가 + 셀 입력
    const fill = async (rowIdx, column, value) => {
      const cell = page.locator('[data-seed-row]').nth(rowIdx).locator(`[data-seed-cell="${column}"]`)
      await cell.click()
      await page.waitForTimeout(150)
      await page.keyboard.type(value)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
    }
    await click('button:has-text("행 추가")')
    await page.waitForSelector('[data-seed-row]', { timeout: 5_000 })
    await fill(0, 'order_number', 'SEED-0001')
    check('Studio › Seed: 셀 입력 반영', (await body()).includes('SEED-0001'))

    // 중복 자연키 → 두 행 모두 오류 표시
    await click('button:has-text("행 추가")')
    await page.waitForTimeout(200)
    await fill(1, 'order_number', 'SEED-0001')
    check('Studio › Seed: 중복 자연키 → 두 행 오류 표시',
      (await page.locator('[data-seed-row-issue="duplicate-key"]').count()) === 2)

    // 값을 바꿔 중복 해소 → 오류 사라짐
    await fill(1, 'order_number', 'SEED-0002')
    check('Studio › Seed: 중복 해소 → 오류 없음', (await page.locator('[data-seed-row-issue]').count()) === 0)

    // 변수 자리표시자 — 환경마다 다른 값은 값 대신 변수로
    await fill(0, 'memo', '{{ADMIN_PASSWORD_HASH}}')
    check('Studio › Seed: 변수 셀 표식', (await page.locator('[data-seed-variable-cell]').count()) === 1)
    check('Studio › Seed: 세트가 요구하는 변수 목록',
      (await page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

    // 관리 강도 전권 → 경고 문구
    await click('[data-seed-strength="authoritative"]')
    await page.waitForTimeout(200)
    check('Studio › Seed: 전권 선택 시 삭제 후보 경고', (await body()).includes('삭제 후보'))

    // 저장(설계 스코프) — 디바운스 후 저장소에 남는다
    await page.waitForTimeout(600)
    const saved = await page.evaluate(async () => {
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
  check('버전 컷: 시드 행 수 표시(스냅샷에 시드 동봉)', (await page.locator('[data-version-seed-rows]').count()) >= 1)

  // ⭐ Version Diff 에 시드 섹션 — 시드 없던 옛 버전(v0.3.14)↔시드 담긴 새 버전(v0.3.15).
  //    CASE-studio-045: 옛 스냅샷 폴백이 깨지지 않고 시드 델타가 보인다.
  await click('button:has-text("Version Diff")')
  await page.waitForSelector('text=버전 비교', { timeout: 8_000 })
  await page.waitForTimeout(400)
  check('Version Diff: 시드 섹션 렌더', (await page.locator('[data-seed-diff]').count()) === 1)
  check('Version Diff: 시드 세트(orders) 델타 표시', (await page.locator('[data-seed-diff-set="orders"]').count()) === 1)
  await click('button:has-text("Timeline")')
  await page.waitForTimeout(300)

  // ── MCP 쓰기 도구(2단계) — 에이전트 쓰기가 열린 화면에 즉시 반영(리하이드레이션) ──
  // CASE-mcp-072/073 (docs/qa/mcp-server.md). 토큰은 위 재발급 이후 값을 새로 조회.
  {
    const st = await page.evaluate(() => window.rockury.mcp.status())
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
    check('MCP 쓰기: tools/list 쓰기 4종 노출', ['create_design', 'update_design', 'set_schema', 'create_version'].every((n) => wNames.includes(n)))
    check('MCP 쓰기: 삭제류 도구 부재', wNames.every((n) => !/delete|remove|drop/.test(n)))

    // create_version(번호 생략 → 최신 v0.3.15 에서 patch 증가) — Versions 타임라인이 열린 채 호출.
    const cut = await callTool('create_version', { designId: 'commerce-core', note: '에이전트 컷' }, 43)
    check('MCP 쓰기: create_version 성공(v0.3.16)', cut?.isError !== true && cut?.content?.[0]?.text?.includes('v0.3.16') === true)
    await page.waitForSelector('text=v0.3.16', { timeout: 5_000 })
    check('MCP 쓰기: 타임라인 즉시 반영(v0.3.16 — 수동 재조회 없음)', (await body()).includes('v0.3.16'))

    // set_schema — Studio Definition 이 열린 채 get_schema 왕복으로 테이블 추가 → 즉시 반영.
    await click('button:has-text("Studio")')
    await click('button:has-text("Definition")')
    await page.waitForSelector('text=orders', { timeout: 5_000 })
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
    await page.waitForSelector('text=mcp_probe', { timeout: 5_000 })
    check('MCP 쓰기: Studio Definition 즉시 반영(mcp_probe)', (await body()).includes('mcp_probe'))

    // 쓰기 오류 규율 — 미상 설계는 프로토콜 오류가 아닌 isError + 해결 안내.
    const bad = await callTool('set_schema', { designId: 'no-such', tables: [] }, 46)
    check('MCP 쓰기: 미상 설계 isError + list_designs 안내', bad?.isError === true && bad?.content?.[0]?.text?.includes('list_designs') === true)
  }

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

  // ── Connection 그룹: 생성(인라인 이름) → 카드 DnD 로 그룹 넣기/빼기 → 그룹 삭제 ──
  {
    await click('button:has-text("새 그룹")')
    await page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await page.locator('input[data-group-rename]').fill('E2E-그룹')
    await page.keyboard.press('Enter')
    await page.waitForSelector('text=E2E-그룹', { timeout: 5_000 })
    check('Connections: 그룹 생성 + 인라인 이름 변경(E2E-그룹)', (await body()).includes('E2E-그룹'))

    // 카드를 그룹 영역으로 드래그 → group_id 영속 (포인터 DnD: 고스트·플레이스홀더 경로)
    const dragCardTo = async (zoneSel) => {
      const cbox = await page.locator('[data-conn-id]').first().boundingBox()
      const zbox = await page.locator(zoneSel).first().boundingBox()
      await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + 12)
      await page.mouse.down()
      await page.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(500) // move IPC 영속 대기
    }
    await dragCardTo('section[data-conn-group]:not([data-conn-group=""])')
    const groupedId = await page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 → 그룹 소속 저장(groupId)', !!groupedId)

    // 그룹에서 미분류 영역으로 드래그 아웃 → group_id 해제
    await dragCardTo('section[data-conn-group=""]')
    const ungroupedId = await page.evaluate(async () => (await window.rockury.connections.list())[0].groupId)
    check('Connections: 카드 드래그 아웃 → 미분류 복귀(groupId null)', ungroupedId === null)

    // 두 번째 그룹을 만들고 그립 핸들 드래그로 순서 뒤집기 → 영속
    await click('button:has-text("새 그룹")')
    await page.waitForSelector('input[data-group-rename]', { timeout: 5_000 })
    await page.locator('input[data-group-rename]').fill('E2E-그룹2')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const orderBefore = await page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    // 두 번째 그룹 핸들을 첫 그룹 위로 끌어올린다
    {
      const handles = page.locator('button[data-group-handle]')
      const h2 = await handles.nth(1).boundingBox()
      const s1 = await page.locator('section[data-conn-group]:not([data-conn-group=""])').first().boundingBox()
      await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2)
      await page.mouse.down()
      await page.mouse.move(s1.x + s1.width / 2, s1.y + 4, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(500)
    }
    const orderAfter = await page.evaluate(async () =>
      (await window.rockury.connectionGroups.list()).map((g) => g.name)
    )
    check(
      'Connections: 그룹 핸들 드래그로 순서 변경(영속·역순)',
      orderBefore.length === 2 && orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]
    )
    // 만든 두 번째 그룹 정리
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await page.waitForTimeout(400)

    // 그룹 삭제(연결은 남아야 함)
    await click('section[data-conn-group] button[title^="그룹 삭제"]')
    await click('button:has-text("그룹 삭제")')
    await page.waitForTimeout(400)
    const afterDelete = await page.evaluate(async () => ({
      groups: (await window.rockury.connectionGroups.list()).length,
      conns: (await window.rockury.connections.list()).length
    }))
    check('Connections: 그룹 삭제 → 그룹 0 개, 연결은 보존', afterDelete.groups === 0 && afterDelete.conns === 1)
  }

  // ── 자동확인 제외: 제외로 바꾸면 잔존 상태가 '미확인'으로 돌아오고, 새로고침이 다시 확인하지 않는다 ──
  //   (회귀: 제외 후에도 옛 '실패/연결됨'이 남아 "계속 확인되는 것처럼" 보이던 문제)
  {
    await click('button[title="편집"]')
    await page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await page.waitForSelector('text=자동확인 제외', { timeout: 5_000 })
    check('Connections: 자동확인 제외 배지 표시', (await body()).includes('자동확인 제외'))
    await click('button:has-text("새로고침")')
    await page.waitForTimeout(800)
    check('Connections: 제외 연결은 새로고침 후 미확인(재확인 안 함)', (await body()).includes('미확인'))
    // 원복 — 이후 흐름은 자동확인 대상 상태를 전제
    await click('button[title="편집"]')
    await page.waitForSelector('text=자동 확인에서 제외', { timeout: 5_000 })
    await click('text=자동 확인에서 제외')
    await click('button[type="submit"]:has-text("저장")')
    await page.waitForTimeout(300)
  }

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

  // JSON 값 — 셀은 구조 요약 칩(`{} n`)으로 보이고, 눌러 열면 정렬된 뷰어가 형식 정상 여부까지 알려 준다.
  await click('aside button:has-text("user_profiles")')
  await page.waitForSelector('tbody tr', { timeout: 15_000 })
  await page.waitForTimeout(300)
  {
    const jsonCell = page.locator('tbody button[title*="눌러서 전체 보기"]').first()
    check('Console › Data: JSON 셀이 구조 요약으로 보임', (await jsonCell.count()) > 0)
    await jsonCell.click()
    await page.waitForSelector('text=형식 정상', { timeout: 8_000 })
    const viewer = await body()
    check('Console › Data: JSON 뷰어 열림(형식 정상 표시)', viewer.includes('형식 정상'))
    check('Console › Data: JSON 뷰어가 보기 좋게 정렬해 보여줌', viewer.includes('한 줄로'))
    await click('button:text-is("취소")')
    await page.waitForTimeout(200)
  }

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

  // ⭐ 운영→설계: 실 DB 를 설계 새 버전으로 가져오기(version-up) — 드리프트 뷰 진입점(운영→설계 관문).
  const countVersions = () => page.evaluate(async () => {
    const ds = await window.rockury.designs.list()
    let n = 0
    for (const d of ds) n += (await window.rockury.versions.list(d.id)).length
    return n
  })
  const vBefore = await countVersions()
  await click('button:has-text("설계로 가져오기")')
  await page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  check('운영→설계: 가져오기 다이얼로그 역설계 미리보기', (await body()).includes('실 DB 에서'))
  await click('button:has-text("새 버전으로 가져오기")')
  await page.waitForTimeout(1500)
  check('운영→설계: 운영 DB 가져와 설계 새 버전 컷', (await countVersions()) === vBefore + 1)

  // ⭐ 운영→설계(새 설계 부트스트랩): 대상 토글 "새 설계로" → 설계+Draft+버전 생성 + 활성 전환.
  //    (사용자 회귀: 설계가 이미 선택돼 있으면 "새 설계로" 갈 길이 없어 늘 버전업으로 샜다.)
  await click('button:has-text("설계로 가져오기")')
  await page.waitForSelector('text=실 DB 에서', { timeout: 15_000 })
  await click('button:has-text("새 설계 만들기")')
  await page.waitForTimeout(200)
  await page.locator('input[placeholder="예: commerce-core"]').fill('e2e-imported')
  await click('button:has-text("설계 만들고 가져오기")')
  await page.waitForTimeout(1800)
  const nd = await page.evaluate(async () => {
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

  // Migration › Logs — 기준선 로그 기록(Phase 3e)
  await click('button:has-text("Logs")')
  await page.waitForSelector('text=기준선', { timeout: 8_000 })
  check('Migration › Logs: 기준선 로그 체인', (await body()).includes('기준선'))

  // ⭐ Environment 관리 UI — 연결 카드에서 설계 바인딩 열람(운영↔설계 결속이 화면에 드러남).
  await click('button:has-text("Connections")')
  await page.waitForSelector('text=E2E-mysql', { timeout: 8_000 })
  await page.locator('button[title="설계 바인딩 관리"]').first().click()
  await page.waitForSelector('text=설계 바인딩 ·', { timeout: 8_000 })
  await page.waitForSelector('text=commerce-core', { timeout: 8_000 }) // 바인딩 행 비동기 로드 대기
  check('Environment 관리: 연결의 설계 바인딩 다이얼로그(commerce-core 표시)', (await body()).includes('commerce-core'))
  await page.locator('button:has-text("닫기")').first().click()
  await page.waitForTimeout(300)

  // ⭐ 운영↔운영 비교(Compare) — 같은 DB 를 가리키는 두 번째 연결과 비교 → 스키마 동일.
  //    IPC 로 만든 연결은 렌더러 스토어(부팅 시 1회 하이드레이션)에 안 잡힘 → reload 로 반영.
  await page.evaluate(() =>
    window.rockury.connections.create({
      name: 'E2E-mysql2', dbType: 'mysql', host: 'localhost', port: 13306,
      database: 'testdb', user: 'test', password: 'test', sslEnabled: false
    })
  )
  await page.reload()
  await page.waitForSelector('text=Studio', { timeout: 15_000 })
  await click('button:has-text("Migration")')
  await click('button:has-text("Compare")')
  await page.waitForSelector('text=실 DB 간 스키마 비교', { timeout: 8_000 })
  await page.locator('[data-slot="select-trigger"]').last().click() // 상대 연결 셀렉터
  await page.locator('[data-slot="select-item"]:has-text("E2E-mysql2")').first().click()
  await click('button:has-text("비교")')
  await page.waitForSelector('text=두 DB 의 스키마가 동일해요', { timeout: 15_000 })
  check('Migration › Compare: 같은 DB 두 연결 → 스키마 동일', (await body()).includes('두 DB 의 스키마가 동일해요'))

  // ⭐ 버전 삭제(잘못 들어간 버전 회수) — Timeline 에서 삭제 → 목록에서 사라짐.
  await click('button:has-text("Versions")')
  await page.waitForSelector('text=버전 타임라인', { timeout: 8_000 })
  await page.waitForTimeout(300)
  const vBeforeDel = await page.locator('[data-version-number]').count()
  const firstRow = page.locator('[data-version-number]').first()
  await firstRow.locator('button[title="버전 삭제"]').click({ force: true })
  await firstRow.locator('button:has-text("삭제")').click()
  await page.waitForTimeout(500)
  check('버전 삭제: Timeline 에서 버전 제거', (await page.locator('[data-version-number]').count()) === vBeforeDel - 1)

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

  // 시드 세트도 콜드 재시작을 넘긴다 — CASE-studio-044(선언·행 잔존).
  await click('button:has-text("Design")')
  await click('[role="menuitem"]:has-text("commerce-core")')
  await page.waitForTimeout(300)
  await click('button:has-text("Studio")')
  await click('button:has-text("Seed")')
  await page.waitForSelector('[data-seed-set-row="orders"]', { timeout: 8_000 })
  const seedAfterRestart = await body()
  check('콜드 재시작 후 시드 세트·행 잔존',
    seedAfterRestart.includes('SEED-0001') && seedAfterRestart.includes('SEED-0002'))
  check('콜드 재시작 후 변수 셀 잔존', (await page.locator('[data-seed-variable="ADMIN_PASSWORD_HASH"]').count()) === 1)

  // 회귀: 재시작 직후(세트를 클릭하지 않은 상태)에도 편집이 먹어야 한다 — activeKey 가 비어 있어
  //   스토어가 대상 세트를 못 찾고 조용히 no-op 되던 문제.
  {
    const before = await page.locator('[data-seed-row]').count()
    await click('button:has-text("행 추가")')
    await page.waitForTimeout(300)
    check('재시작 직후 편집 반영(행 추가 no-op 회귀)', (await page.locator('[data-seed-row]').count()) === before + 1)
  }

  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
} catch (e) {
  console.error('SMOKE FAIL:', e.message.split('\n')[0])
  pass = false
} finally {
  await app.close().catch(() => {})
  fs.rmSync(USER_DATA, { recursive: true, force: true }) // 임시 userData 만 정리(실 DB 무관)
}
process.exit(pass ? 0 : 1)
