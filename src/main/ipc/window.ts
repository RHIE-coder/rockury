import { BrowserWindow, ipcMain } from 'electron'
import { normalizeSession, type WindowSession } from '../../shared/windowSession'
import { createAppWindow, setWindowSession, windowSessionOf } from '../windows'

/** 렌더러가 보낸 세션을 되풀어 확인한다 — 성하지 않으면 null. */
function asSession(raw: unknown): WindowSession | null {
  const input = raw as Partial<WindowSession> | null
  return normalizeSession({
    tabs: Array.isArray(input?.tabs) ? input.tabs : [],
    active: typeof input?.active === 'number' ? input.active : 0
  })
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
   * 자리를 창 하나로 떼어낸다 — 탭 줄의 "새 창" 단추, 그리고 탭을 창 밖으로 끌어 놓았을 때.
   * 무엇을 열지는 렌더러가 보낸 세션이 정하고, 안 보내면 부른 창이 지금 보는 것을 그대로 문다.
   */
  ipcMain.on('window:open', (event, raw: unknown) => {
    const from = BrowserWindow.fromWebContents(event.sender)
    const session = asSession(raw) ?? (from ? windowSessionOf(from) : undefined)
    // 떼어낸 창은 브라우저 저장소의 주인이 아니다 — 첫 창이 그 자리를 계속 쥔다.
    createAppWindow({ session, primary: false })
  })
}
