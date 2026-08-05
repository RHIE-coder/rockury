import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeWindowBoot, type WindowSession } from '../shared/windowSession'
import type { StripRect, WindowStrip } from './windowDrag'
import { cascadeBounds, defaultWindowBounds, usableBounds, type Rect } from './windowSize'
import { normalizeWindowStore, type StoredWindow } from './windowStore'

/**
 * 앱 창 만들기·되살리기 — 창은 **여러 개** 뜬다(2026-08-05 사용자 요청: "여러 화면을 대조하며 보고 싶다").
 *
 * 창끼리는 저절로 갈린다: 렌더러가 창마다 따로 뜨므로 "지금 어느 설계·접속·시점을 보나"도
 * 창마다 따로다. 그래서 대조는 창을 하나 더 띄우는 것으로 끝난다 — 서비스 스토어를 창 단위로
 * 가르는 공사가 필요 없다.
 *
 * **창이 무엇을 들고 있나(탭 목록·활성)의 주인은 여기다.** 렌더러의 브라우저 저장소에 두면 창끼리
 * 같은 저장소 하나를 써서 서로를 덮어쓴다 — 그래서 창 밖인 여기가 든다. 덕분에 껐을 때 떠 있던
 * 창들이 다음 실행에 그대로 돌아온다(처음엔 떼어낸 창을 저장에서 빼는 것으로 덮어쓰기만 막았고,
 * 그 대가로 안 돌아왔다).
 *
 * 프로세스는 여전히 하나다(`requestSingleInstanceLock`) — 잠금이 막는 것은 창 개수가 아니라
 * 로컬 저장소·MCP 포트의 주인이 둘이 되는 일이다. 한 프로세스가 창을 여럿 여는 건 걸리지 않는다.
 */

/** 창이 아무것도 안 물려받았을 때의 첫 자리 — 빈 모듈 id 는 "첫 모듈" 폴백이다(렌더러가 푼다). */
const DEFAULT_SESSION: WindowSession = {
  tabs: [{ serviceId: 'db', moduleId: '', viewId: null }],
  active: 0
}

/** 창마다 지금 들고 있는 것. 렌더러가 탭을 만들거나 옮길 때마다 되보고해 갱신된다. */
const sessions = new WeakMap<BrowserWindow, WindowSession>()

/**
 * 창마다 탭 줄이 **창 안 어디**인지. 끌고 온 탭을 어느 창이 삼킬지 여기서 가른다.
 *
 * 창 기준 좌표로 든다 — 화면 좌표로 받아 두면 사용자가 창을 옮기는 순간 낡는데, 창이 옮겨진
 * 것을 렌더러는 모른다(창 이동에는 `resize` 가 안 온다). 화면 좌표는 쓸 때 그 자리에서 만든다.
 */
const strips = new WeakMap<BrowserWindow, StripRect>()

/**
 * 마지막으로 **비어 있지 않던** 배치. 끌 때 이 값을 파일에 남긴다.
 *
 * 왜 "마지막 비지 않은" 값인가: 윈도우·리눅스에서는 창을 다 닫는 것이 곧 종료라, 종료 시점에
 * 살아 있는 창을 세면 늘 0 이다. 그러면 다음 실행에 되살릴 것이 없어진다.
 */
let lastLayout: StoredWindow[] = []

function layoutFile(): string {
  return join(app.getPath('userData'), 'window-layout.json')
}

/** 지금 배치를 기억해 둔다 — 창이 생기거나 사라지거나 옮겨지거나 탭이 바뀔 때마다. */
export function rememberLayout(): void {
  const live = BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed())
    .map((w) => ({ ...(sessions.get(w) ?? DEFAULT_SESSION), bounds: w.getBounds() }))
  if (live.length > 0) lastLayout = live
}

/** 렌더러가 되보고한 탭 상태를 그 창에 새긴다. */
export function setWindowSession(win: BrowserWindow, session: WindowSession): void {
  sessions.set(win, session)
  rememberLayout()
}

/** 이 창이 지금 들고 있는 것 — 새 창을 열 때 물려줄 값을 여기서 뽑는다. */
export function windowSessionOf(win: BrowserWindow): WindowSession {
  return sessions.get(win) ?? DEFAULT_SESSION
}

/** 렌더러가 되보고한 탭 줄 자리를 그 창에 새긴다(창 기준 좌표). */
export function setWindowStrip(win: BrowserWindow, strip: StripRect): void {
  strips.set(win, strip)
}

/**
 * 지금 탭 줄을 내보이고 있는 창들 — 끌고 온 탭을 삼킬 후보다.
 * 안 보이는 창(최소화·끌려 나오는 중이라 잠시 감춘 창)과 `exclude` 는 뺀다.
 */
export function windowStrips(exclude?: number): WindowStrip<number>[] {
  const out: WindowStrip<number>[] = []
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.id === exclude || !win.isVisible()) continue
    const strip = strips.get(win)
    if (strip) out.push({ id: win.id, content: win.getContentBounds(), strip })
  }
  return out
}

/** 껐을 때의 배치를 파일로 남긴다. 못 써도 앱은 정상 종료한다(다음 실행이 기본 창을 연다). */
export function saveLayout(): void {
  rememberLayout()
  try {
    writeFileSync(layoutFile(), JSON.stringify({ windows: lastLayout }), 'utf8')
  } catch {
    // 배치를 못 남겨도 앱 동작에는 지장이 없다 — 다음 실행이 기본 창 하나로 뜬다.
  }
}

function readLayout(): StoredWindow[] {
  try {
    return normalizeWindowStore(JSON.parse(readFileSync(layoutFile(), 'utf8')))
  } catch {
    // 파일이 없는 첫 실행이 여기로 온다 — 정상이다.
    return []
  }
}

function boundsFor(saved: Rect | null): Rect {
  // 저장된 자리가 지금 화면에 살아 있으면 그대로 — 사용자가 놓아 둔 자리를 지킨다.
  const kept = saved ? usableBounds(saved, screen.getAllDisplays().map((d) => d.workArea)) : null
  if (kept) return kept

  // 커서가 있는 화면에 띄운다 — 사용자가 지금 보고 있는 모니터. 위치를 직접 정해야
  // 창이 좁은 모니터에 걸려 폭이 잘리지 않는다(defaultWindowBounds 주석 참고).
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const base = defaultWindowBounds(target.workArea)
  // 이미 떠 있는 창 수만큼 밀어 놓는다 — 정확히 겹치면 새 창이 떴는지가 화면상 안 보인다.
  return cascadeBounds(base, target.workArea, BrowserWindow.getAllWindows().length)
}

export function createAppWindow(
  options: {
    session?: WindowSession
    bounds?: Rect
    primary?: boolean
    /**
     * 초점을 안 가져가고 곧바로 띄운다 — 탭을 끌어 떼어내는 중일 때다.
     * 마우스를 쥔 쪽은 원래 창이라, 새 창이 앞으로 나서면 끌기가 그 자리에서 끊긴다.
     */
    inactive?: boolean
  } = {}
): BrowserWindow {
  const session = options.session ?? DEFAULT_SESSION
  // 브라우저 저장소(대상 선택·마지막 자리 기억)를 쓸 수 있는 창은 하나뿐이다 — 첫 창이 그것이다.
  const primary = options.primary ?? BrowserWindow.getAllWindows().length === 0
  const { x, y, width, height } = boundsFor(options.bounds ?? null)

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 창이 무엇을 들고 열리는지를 **실행 인자로** 넘긴다. 주소나 IPC 로 밀면 렌더러가 뜬 뒤에야
      // 도착해서 기본 자리가 한 번 그려졌다 갈아치워진다 — 인자면 첫 그림부터 제자리다.
      additionalArguments: [encodeWindowBoot({ primary, session })]
    }
  })

  sessions.set(win, session)

  if (options.inactive) {
    // 내용이 차기 전에 흰 창을 **먼저** 띄운다 — 탭을 빼낸 손끝에 창이 바로 따라 나와야
    // "떨어져 나왔다"가 읽힌다. 화면이 그려질 때까지 기다리면 반 박자가 빈다.
    win.showInactive()
    win.on('ready-to-show', () => win.showInactive())
  } else {
    win.on('ready-to-show', () => win.show())
  }
  // 자리·크기는 창에서 바로 읽으므로 따로 안 들고, 바뀌었다는 사실만 기억에 반영한다.
  win.on('moved', rememberLayout)
  win.on('resized', rememberLayout)
  win.on('closed', rememberLayout)

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite: dev 서버 URL 또는 빌드된 HTML 로드
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) win.loadURL(rendererUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  rememberLayout()
  return win
}

/**
 * 부팅 — 지난번에 떠 있던 창들을 되살린다. 되살릴 것이 없으면(첫 실행·깨진 저장본) 창 하나.
 * **첫 창만** 브라우저 저장소의 주인이다.
 */
export function restoreWindows(): void {
  const saved = readLayout()
  if (saved.length === 0) {
    createAppWindow({ primary: true })
    return
  }
  for (const [i, w] of saved.entries()) {
    createAppWindow({
      session: { tabs: w.tabs, active: w.active },
      bounds: w.bounds,
      primary: i === 0
    })
  }
}
