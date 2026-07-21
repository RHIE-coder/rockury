import { BrowserWindow, ipcMain } from 'electron'

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
}
