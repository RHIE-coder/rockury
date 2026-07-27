// 빌드된 Rockury 앱 구동 스모크 — 서비스별 흐름(e2e/flows/<서비스>.mjs)을 순서대로 돌린다.
// 주의: getByRole 계열은 이 창을 크래시시킴 → CSS/text 로케이터만 사용.
// 운영부 섹션(연결 테스트)은 test-db(mysql:13306)가 떠 있어야 한다 → `npm run db:up`.
// ⚠ 이 스모크는 **실 앱 DB(userData)를 절대 건드리지 않는다** — 격리된 임시 userData 로
//    앱을 띄우고(--user-data-dir), 종료 시 그 임시 디렉터리만 지운다.
//    (e2e/isolation.test.ts 가 이 파일과 e2e/flows/*.mjs 전부를 검사해 강제)
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createContext } from './context.mjs'
import { FLOWS } from './flows/index.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

const launch = () =>
  electron.launch({
    executablePath: electronBin,
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    // MCP 포트 0 = OS 배정 — 개발 앱(기본 41729)과 충돌 없이 격리 구동. 실제 주소는 상태 IPC 로 확인.
    env: { ...process.env, ROCKURY_MCP_PORT: '0' },
    timeout: 30_000
  })

const ctx = createContext({ launch, userData: USER_DATA })

try {
  await ctx.start()
  await ctx.page.waitForSelector('text=Studio', { timeout: 15_000 })
  await ctx.page.evaluate(() => localStorage.clear())
  await ctx.page.reload()
  await ctx.page.waitForSelector('text=Studio', { timeout: 15_000 })
  ctx.check('앱 부팅 + DB 서비스 셸 렌더', (await ctx.body()).includes('Studio'))

  // 서비스별 흐름을 잇달아 돌린다 — 앱은 한 번만 띄우고 창을 이어서 조작한다.
  // 한 서비스가 터져도 나머지는 계속 돈다: 한 서비스의 회귀가 다른 서비스의 검사를
  // 통째로 가리면, 고칠 때마다 한 개씩만 드러나 여러 번 왕복하게 된다.
  for (const flow of FLOWS) {
    try {
      await flow.run(ctx)
    } catch (e) {
      console.error(`FLOW FAIL [${flow.service}]: ${(e?.message || String(e)).split('\n')[0]}`)
      ctx.pass = false
    }
  }

  console.log(ctx.pass ? '\nALL PASS' : '\nSOME FAILED')
} catch (e) {
  console.error('SMOKE FAIL:', (e?.message || String(e)).split('\n')[0])
  ctx.pass = false
} finally {
  await ctx.close()
  fs.rmSync(USER_DATA, { recursive: true, force: true }) // 임시 userData 만 정리(실 DB 무관)
}
process.exit(ctx.pass ? 0 : 1)
