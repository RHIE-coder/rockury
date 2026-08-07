import { BrowserWindow, ipcMain, screen } from 'electron'
import { decodeNavLocation, encodeNavLocation, type NavLocation } from '../../shared/navLocation'
import { normalizeSession, type WindowSession } from '../../shared/windowSession'
import { stripUnderPoint, tearOffBounds, type Point, type StripRect } from '../windowDrag'
import { defaultWindowSize } from '../windowSize'
import {
  createAppWindow,
  setWindowSession,
  setWindowStrip,
  windowSessionOf,
  windowStrips
} from '../windows'

/** 렌더러가 보낸 세션을 되풀어 확인한다 — 성하지 않으면 null. */
function asSession(raw: unknown): WindowSession | null {
  const input = raw as Partial<WindowSession> | null
  return normalizeSession({
    tabs: Array.isArray(input?.tabs) ? input.tabs : [],
    active: typeof input?.active === 'number' ? input.active : 0
  })
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asPoint(raw: unknown): Point | null {
  const p = raw as Partial<Point> | null
  const x = num(p?.x)
  const y = num(p?.y)
  return x === null || y === null ? null : { x, y }
}

function asStrip(raw: unknown): StripRect | null {
  const r = raw as Partial<StripRect> | null
  const left = num(r?.left)
  const top = num(r?.top)
  const width = num(r?.width)
  const height = num(r?.height)
  if (left === null || top === null || width === null || height === null) return null
  return width > 0 && height > 0 ? { left, top, width, height } : null
}

/** 자리 하나를 되풀어 확인한다 — 접힌 글자열로 오므로 되펴서 모양을 본다. */
function asLocation(raw: unknown): NavLocation | null {
  const loc = raw as Partial<NavLocation> | null
  if (!loc || typeof loc.serviceId !== 'string' || typeof loc.moduleId !== 'string') return null
  return decodeNavLocation(
    encodeNavLocation({
      serviceId: loc.serviceId,
      moduleId: loc.moduleId,
      viewId: typeof loc.viewId === 'string' ? loc.viewId : null
    })
  )
}

function liveWindow(id: number | null): BrowserWindow | null {
  if (id === null) return null
  const win = BrowserWindow.fromId(id)
  return win && !win.isDestroyed() ? win : null
}

/**
 * 렌더러가 준 **창 안 좌표**를 화면 좌표로 편다. 화면 좌표를 만드는 곳은 여기 하나다
 * (`windowDrag.ts` 머리말 참고 — 렌더러가 직접 재면 창을 옮긴 뒤 낡는다).
 */
function toScreen(win: BrowserWindow, at: Point): Point {
  const content = win.getContentBounds()
  return { x: content.x + at.x, y: content.y + at.y }
}

/**
 * 지금 손에 끌려가는 창 하나. `hovering` 은 놓으면 이 탭을 삼킬 창이다.
 *
 * 한 번에 하나뿐이라 모듈 변수로 든다 — 마우스는 하나고, 끌기는 놓을 때까지 이어지는 한 사건이다.
 *
 * `self` 는 **탭을 떼어내 만든 창이 아니라 원래 창 자신**이라는 뜻이다(마지막 한 장을 끌 때).
 * 그 창은 마우스를 쥐고 있어서 감출 수 없다 — 다루는 법이 갈리므로 표시해 둔다.
 */
let dragging: { id: number; hovering: number | null; self: boolean } | null = null

/** 삼킬 상대가 바뀌었다 — 예전 상대의 떨어질 자리 표시를 지운다. */
function clearHover(id: number | null): void {
  liveWindow(id)?.webContents.send('window:dragHover', null)
}

/**
 * 프레임리스 창을 위한 창 제어 IPC.
 * 렌더러의 커스텀 Titlebar가 preload(window.rockury.window)를 통해 호출한다.
 */
export function registerWindowIpc(): void {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  /**
   * `⌘W` 로 마지막 탭을 닫을 때 — 창을 닫되 **마지막 창이면 안 닫는다**.
   * 키 하나로 앱이 통째로 꺼지지 않게 하는 것이고, 창 수를 아는 쪽이 여기라 판정도 여기서 한다.
   */
  ipcMain.on('window:closeUnlessLast', (event) => {
    if (BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length <= 1) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  /**
   * 창이 지금 무엇을 들고 있나 — 탭이 생기거나 닫히거나 자리를 옮길 때마다 렌더러가 되보고한다.
   *
   * 메인이 이 값의 주인이라 껐다 켜면 그대로 되살아난다. 받은 값은 **되풀어 확인한다** —
   * 렌더러에서 온 것이 그대로 다음 실행의 창 목록이 되는 길이라, 모양 검사 없이 받으면
   * 깨진 값 하나가 다음 부팅을 망가뜨린다.
   */
  ipcMain.on('window:session', (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const session = asSession(raw)
    if (win && session) setWindowSession(win, session)
  })

  /**
   * 자리를 창 하나로 떼어낸다 — 탭 줄의 "새 창" 단추와 메뉴의 `⌘N`.
   * 무엇을 열지는 렌더러가 보낸 세션이 정하고, 안 보내면 부른 창이 지금 보는 것을 그대로 문다.
   */
  ipcMain.on('window:open', (event, raw: unknown) => {
    const from = BrowserWindow.fromWebContents(event.sender)
    const session = asSession(raw) ?? (from ? windowSessionOf(from) : undefined)
    // 떼어낸 창은 브라우저 저장소의 주인이 아니다 — 첫 창이 그 자리를 계속 쥔다.
    createAppWindow({ session, primary: false })
  })

  /** 이 창의 탭 줄이 창 안 어디에 있나 — 끌고 온 탭을 누가 삼킬지 가르는 데 쓴다. */
  ipcMain.on('window:strip', (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const strip = asStrip(raw)
    if (win && strip) setWindowStrip(win, strip)
  })

  /**
   * 탭을 줄 밖으로 끌어 냈다 — **그 자리에서** 창을 만들어 커서에 붙인다(브라우저와 같다).
   * 예전엔 손을 놓은 자리가 창 밖일 때만 만들었는데, 창을 꽉 채워 놓으면 창 밖이 없어 영영 안 됐다.
   *
   * 크기는 **끌어낸 창과 같게** 준다 — 보던 화면이 그대로 옮겨 가야 대조가 된다. 다만 꽉 채운
   * 창에서 빼낼 때는 화면만 한 창이 튀어나오므로 그때만 기본 크기로 연다.
   */
  ipcMain.handle('window:tearOff', (event, raw: unknown) => {
    const from = BrowserWindow.fromWebContents(event.sender)
    const input = raw as { loc?: unknown; at?: unknown; grab?: unknown } | null
    const loc = asLocation(input?.loc)
    const at = asPoint(input?.at)
    const grab = asPoint(input?.grab)
    if (!from || !loc || !at || !grab) return null

    const cursor = toScreen(from, at)
    const work = screen.getDisplayNearestPoint(cursor).workArea
    const source = from.getContentBounds()
    const size =
      from.isMaximized() || from.isFullScreen()
        ? defaultWindowSize(work)
        : { width: source.width, height: source.height }

    const win = createAppWindow({
      session: { tabs: [loc], active: 0 },
      bounds: tearOffBounds(size, cursor, grab, work),
      primary: false,
      inactive: true
    })
    dragging = { id: win.id, hovering: null, self: false }
    return win.id
  })

  /**
   * 마지막 한 장을 줄 밖으로 빼냈다 — 뗄 것이 없으니 **이 창을 통째로** 끈다(브라우저와 같다).
   * 떼어내면 빈 창이 남을 뿐이라, 남길 창이 곧 끌고 갈 창이다.
   *
   * 꽉 채운 창은 먼저 되돌린다 — 화면만 한 창은 손을 따라와도 옮겨진 티가 안 나고, 다른 창의
   * 탭 줄을 통째로 덮어 어디에 놓는지도 안 보인다. 전체화면은 아예 안 받는다(제 화면을 따로
   * 쓰는 창이라 끌어 옮길 자리가 없다).
   */
  ipcMain.handle('window:dragSelf', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isFullScreen()) return null
    if (win.isMaximized()) win.unmaximize()
    dragging = { id: win.id, hovering: null, self: true }
    return win.id
  })

  /**
   * 끌려 나온 창을 커서 따라 옮긴다. 다른 창의 탭 줄 위에 오면 **그 창을 감추고** 상대 줄에
   * 떨어질 자리를 표시한다 — 안 감추면 제가 상대의 줄을 덮어 표시가 안 보이고, 어디에 놓이는지
   * 모르는 채로 손을 놓게 된다.
   */
  ipcMain.on('window:dragMove', (event, raw: unknown) => {
    const from = BrowserWindow.fromWebContents(event.sender)
    const input = raw as { id?: unknown; at?: unknown; grab?: unknown } | null
    const at = asPoint(input?.at)
    const grab = asPoint(input?.grab)
    const win = liveWindow(num(input?.id))
    if (!from || !at || !grab || !win || dragging?.id !== win.id) return

    const cursor = toScreen(from, at)
    const target = stripUnderPoint(windowStrips(win.id), cursor)

    if (target !== dragging.hovering) {
      clearHover(dragging.hovering)
      dragging.hovering = target
      // 창 자신을 끌고 있으면 **감추지 않는다** — 마우스를 쥔 창이라 감추면 끌기가 그 자리에서
      // 끊겨 창이 사라진 채로 남는다. 대신 비쳐 보이게 해서 뒤에 깔린 상대 줄의 표시를 읽힌다.
      if (dragging.self) win.setOpacity(target === null ? 1 : 0.4)
      else if (target !== null) win.hide()
      else win.showInactive()
    }

    // 상대 줄에 얹힌 동안은 **멈춰 세운다.** 감춘 창이야 옮길 것도 없고, 창 자신을 끄는 중이라도
    // 얹혀 있는데 창이 계속 떠다니면 어느 틈에 놓이는지가 손끝에서 흔들린다(줄 위에서는 창이
    // 아니라 떨어질 자리 표시가 답해야 한다). 줄을 벗어나면 다시 손을 따라온다.
    if (target !== null) {
      const into = liveWindow(target)
      if (into) into.webContents.send('window:dragHover', cursor.x - into.getContentBounds().x)
      return
    }

    const bounds = win.getContentBounds()
    const work = screen.getDisplayNearestPoint(cursor).workArea
    win.setContentBounds(tearOffBounds(bounds, cursor, grab, work))
  })

  /**
   * 손을 놓았다 — 다른 창의 탭 줄 위였으면 그 창이 삼키고 끌려가던 창은 사라진다.
   * 아니면 그 자리에 창으로 남는다(마지막 한 장을 끌었으면 원래 창이 그 자리로 옮겨진 것이다).
   */
  ipcMain.handle('window:dragEnd', (event, raw: unknown) => {
    const from = BrowserWindow.fromWebContents(event.sender)
    const input = raw as { id?: unknown; at?: unknown } | null
    const at = asPoint(input?.at)
    const win = liveWindow(num(input?.id))
    if (!win || dragging?.id !== win.id) return false

    const into = liveWindow(dragging.hovering)
    const self = dragging.self
    dragging = null

    if (!into || !from || !at) {
      if (self) win.setOpacity(1)
      win.show()
      win.focus()
      return false
    }

    const loc = windowSessionOf(win).tabs[0]
    const cursor = toScreen(from, at)
    into.webContents.send('window:adopt', { loc, x: cursor.x - into.getContentBounds().x })
    into.focus()
    // 들고 있던 탭이 상대 줄로 넘어갔으니 남는 것은 빈 창이다 — 곧바로 없앤다.
    win.destroy()
    return true
  })
}
