// 앱 구동 스모크 공용 하네스 — 앱 기동·조작 헬퍼 + 체크포인트 기록.
// 스위트(e2e/suites/*.mjs)는 여기서 만든 ctx 하나만 받아 돌아간다.
//
// ⚠ 이 스모크는 **실 앱 DB(userData)를 절대 건드리지 않는다** — 격리된 임시 userData 로
//    앱을 띄우고(--user-data-dir), 종료 시 그 임시 디렉터리만 지운다. (e2e/isolation.test.ts 가 강제)
// ⚠ 접근성 쿼리(getByRole 등)는 이 Electron 창을 크래시시킨다 → CSS/text 로케이터만 쓴다.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as net from 'node:net'
import { fileURLToPath } from 'node:url'

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronBin = path.join(
  APP,
  process.platform === 'darwin'
    ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    : 'node_modules/electron/dist/electron'
)
const MAIN = path.join(APP, 'out/main/index.js')

/** test-db(mysql) 포트 — needsDb 스위트 사전 점검용. */
const DB_PROBE = { host: '127.0.0.1', port: 13306 }

/**
 * 검사 창 크기(고정) — 스모크가 환경에 흔들리지 않게 못박는다.
 * 앱은 "커서가 있는 화면"에 창을 띄우므로(src/main/index.ts) 실행마다 창이 1080×720 ~ 1512×945 로
 * 달라졌고, 그 결과 노드가 미니맵 밑에 들어가 드래그가 안 되는 등 **환경 의존 실패**가 났다(실측).
 */
const WINDOW = { w: 1440, h: 900 }

/** 창을 주 디스플레이의 고정 크기로 맞춘다(콜드 재시작 후에도 같은 조건). */
async function pinWindow(app) {
  return app.evaluate(async ({ BrowserWindow, screen }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const wa = screen.getPrimaryDisplay().workArea
    win.setResizable(true)
    win.unmaximize()
    // 위치 → 크기 순서. 반대로 하면 옮기는 도중 좁은 화면에 걸려 macOS 가 폭을 잘라 버린다.
    win.setBounds({ x: wa.x + 16, y: wa.y + 16, width: size.w, height: size.h })
    win.setContentSize(size.w, size.h)
    const [w, h] = win.getContentSize()
    return { w, h }
  }, WINDOW)
}

export function requireBuild() {
  if (!fs.existsSync(MAIN)) {
    console.error('먼저 `npm run build` 를 실행하세요 (out/main/index.js 없음).')
    process.exit(1)
  }
}

/** test-db 가 떠 있나(TCP 접속 가능) — 깊은 곳에서 15초 타임아웃으로 죽지 않게 미리 본다. */
export function probeTestDb(timeoutMs = 1_500) {
  return new Promise((resolve) => {
    const sock = net.connect(DB_PROBE.port, DB_PROBE.host)
    const done = (ok) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/**
 * 스모크 실행 컨텍스트를 만든다(앱 기동 포함).
 * ctx.page 는 콜드 재시작(relaunch)으로 바뀌므로, 헬퍼들은 항상 **현재** ctx.page 를 읽는다.
 */
export async function createContext() {
  // 격리된 임시 userData — 실 앱 DB 를 건드리지 않는 clean 시드.
  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rockury-e2e-'))
  const launch = () =>
    electron.launch({
      executablePath: electronBin,
      args: [MAIN, `--user-data-dir=${USER_DATA}`],
      // MCP 포트 0 = OS 배정 — 개발 앱(기본 41729)과 충돌 없이 격리 구동. 실제 주소는 상태 IPC 로 확인.
      // ROCKURY_E2E=1 — OS 가 그리는 것 둘을 끈다: 내려받기 저장 창(뜨면 창이 얼어붙는데 닫을
      // 손이 없다)과 초점 뺏기(검사가 도는 동안 사람이 다른 일을 못 한다). `main/e2eMode.ts` 참고.
      env: { ...process.env, ROCKURY_MCP_PORT: '0', ROCKURY_E2E: '1' },
      timeout: 30_000
    })
  /**
   * 미저장 변경 가드 등 `window.confirm`·`alert` 은 자동 수락(사용자가 "예"를 누른 것으로).
   *
   * **모든 창에** 건다. 예전엔 첫 창에만 걸어서, 탭을 떼어낸 창처럼 나중에 생긴 창에서 물음이
   * 뜨면 아무도 안 눌렀다 — 그 창은 통째로 멈추고 뒤 스위트가 전부 타임아웃으로 흘렀다
   * (2026-08-07 실측). 물음은 렌더러를 붙잡는 것이라 자동화가 스스로 빠져나올 길이 없다.
   */
  const acceptDialogs = (electronApp) => {
    const arm = (p) => p.on('dialog', (d) => d.accept().catch(() => {}))
    electronApp.on('window', arm)
    for (const p of electronApp.windows()) arm(p)
  }

  const app = await launch()
  const page = await app.firstWindow()
  acceptDialogs(app)
  const got = await pinWindow(app)
  if (!got || got.w !== WINDOW.w || got.h !== WINDOW.h) {
    console.warn(
      `[e2e] ⚠ 검사 창을 ${WINDOW.w}×${WINDOW.h} 로 못 맞췄습니다(실제 ${got ? `${got.w}×${got.h}` : '없음'}).` +
        ' 주 디스플레이가 좁으면 레이아웃 의존 체크가 다르게 나올 수 있습니다.'
    )
  }

  const ctx = {
    app,
    page,
    USER_DATA,
    fs,
    path,
    /** 현재 스위트가 기록될 체크포인트 — runner 가 갈아 끼운다. */
    onCheck: null,
    click: (sel) => {
      if (process.env.E2E_TRACE) console.log('[click]', sel)
      return ctx.page.locator(sel).first().click()
    },
    body: () => ctx.page.evaluate(() => document.body.innerText),
    /**
     * 컨텍스트 바 선택을 심는다 — "이 접속·이 명세를 보고 있는 상태"를 만든다.
     *
     * 대상 선택은 **탭에 딸린다**(2026-08-07). 그래서 브라우저 저장소에 써 놓고 reload 하는
     * 예전 방식은 안 먹는다: 탭의 주인은 메인이라 새로고침해도 메인이 든 값이 이긴다.
     * 지금 보고 있는 탭에 바로 세운다 — 화면을 눌러 고르는 것과 같은 길이다.
     */
    setContext: (selectorId, optionId) =>
      ctx.page.evaluate(
        ([id, opt]) => window.__rockuryNav.setContextValue(id, opt),
        [selectorId, optionId]
      ),
    // CodeMirror(.cm-content)에 SQL 입력 — 전체선택→삭제→타이핑→자동완성 팝업 닫기.
    typeSql: async (text) => {
      await ctx.page.locator('.cm-content').click()
      await ctx.page.keyboard.press('ControlOrMeta+A')
      await ctx.page.keyboard.press('Backspace')
      await ctx.page.keyboard.type(text)
      await ctx.page.keyboard.press('Escape')
    },
    check: (label, cond) => {
      const ok = !!cond
      console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label)
      ctx.onCheck?.(label, ok)
      return ok
    },
    /** 콜드 재시작(프로세스 종료→재기동, 같은 userData) — 진짜 영속 검증용. 새 page 를 돌려준다. */
    relaunch: async () => {
      await ctx.app.close()
      ctx.app = await launch()
      ctx.page = await ctx.app.firstWindow()
      acceptDialogs(ctx.app)
      await pinWindow(ctx.app)
      await ctx.page.waitForSelector('text=Design', { timeout: 15_000 })
      return ctx.page
    },
    /**
     * 오버레이(미니맵·컨트롤·툴바)에 덮이지 않아 **실제로 집을 수 있는** ERD 노드를 고른다.
     * boundingBox 는 가려져도 좌표를 주므로, 그대로 mousedown 하면 미니맵이 이벤트를 먹어
     * 드래그가 조용히 안 된다(실측 회귀: 창이 좁을 때 마지막 노드가 미니맵 아래로 들어갔다).
     * 뒤(최근 추가)에서부터 훑어 hit-test 가 그 노드로 떨어지는 첫 노드를 돌려준다.
     */
    pickDraggableNode: async (sel = '.react-flow__node[data-id]') => {
      const n = await ctx.page.locator(sel).count()
      for (let i = n - 1; i >= 0; i--) {
        const nd = ctx.page.locator(sel).nth(i)
        const hit = await ctx.nodeGrabPoint(nd)
        if (hit) return hit
      }
      return null
    },
    /**
     * 그 노드의 머리(헤더)를 실제로 집을 수 있나 — hit-test 가 그 노드로 떨어지면 좌표를 돌려준다.
     * 특정 노드를 반드시 끌어야 하는 검사(예: t:users 레이아웃 영속)에서 "조용히 안 끌림 → 거짓 통과"를 막는다.
     */
    nodeGrabPoint: async (nd) => {
      const box = await nd.boundingBox()
      if (!box) return null
      const from = { x: box.x + box.width / 2, y: box.y + 8 }
      const id = await nd.getAttribute('data-id')
      const hits = await ctx.page.evaluate(
        ({ x, y, id }) =>
          document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') === id,
        { ...from, id }
      )
      return hits ? { nd, box, from, id } : null
    },
    close: async () => {
      await ctx.app.close().catch(() => {})
      fs.rmSync(USER_DATA, { recursive: true, force: true }) // 임시 userData 만 정리(실 DB 무관)
    }
  }
  return ctx
}

/**
 * 체크포인트 기록 — 스위트별 상태와 체크 결과를 파일에 쌓는다.
 * 목적: 중간에 죽어도 **어디까지 돌았고 무엇이 미실행인지** 남는다("돌렸다"는 착각 차단).
 * 체크 하나마다 flush 하므로 프로세스가 강제 종료돼도 직전까지는 남는다.
 */
export function createCheckpoint(file, meta = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const rec = { startedAt: new Date().toISOString(), finishedAt: null, ...meta, suites: [], summary: {} }
  let cur = null
  const flush = () => {
    rec.summary = {
      pass: rec.suites.filter((s) => s.status === 'pass').length,
      fail: rec.suites.filter((s) => s.status === 'fail').length,
      skipped: rec.suites.filter((s) => s.status === 'skipped').length,
      notrun: rec.suites.filter((s) => s.status === 'notrun').length,
      checks: rec.suites.reduce((n, s) => n + s.checks.length, 0),
      failedChecks: rec.suites.reduce((n, s) => n + s.checks.filter((c) => !c.ok).length, 0)
    }
    fs.writeFileSync(file, JSON.stringify(rec, null, 2))
  }
  return {
    file,
    record: rec,
    /** 스위트 시작 — 이후 check 는 이 스위트에 귀속된다. */
    begin(name, needsDb) {
      cur = { name, needsDb: !!needsDb, status: 'running', startedAt: new Date().toISOString(), checks: [], error: null }
      rec.suites.push(cur)
      flush()
      return (label, ok) => {
        cur.checks.push({ label, ok })
        flush()
      }
    },
    end(status, error) {
      if (!cur) return
      cur.status = status
      cur.error = error ?? null
      cur.finishedAt = new Date().toISOString()
      cur = null
      flush()
    },
    /** 실행하지 않은 스위트를 사유와 함께 남긴다(미검증을 숨기지 않는다). */
    mark(name, needsDb, status, reason) {
      rec.suites.push({ name, needsDb: !!needsDb, status, reason, checks: [] })
      flush()
    },
    finish() {
      rec.finishedAt = new Date().toISOString()
      flush()
    }
  }
}
