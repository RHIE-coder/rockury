import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerWindowIpc } from './ipc/window'
import { registerStoreIpc } from './ipc/store'
import { registerConnectionIpc } from './ipc/connections'
import { registerEnvironmentIpc } from './ipc/environments'
import { registerIntrospectionIpc } from './ipc/introspection'
import { registerQueryIpc } from './ipc/query'
import { registerMigrationIpc } from './ipc/migration'
import { registerCollectionIpc } from './ipc/collections'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite: dev 서버 URL 또는 빌드된 HTML 로드
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 미패키징 실행에서도 userData 경로가 'Electron' 이 아닌 앱 이름으로 잡히도록 명시.
app.setName('Rockury')

app.whenReady().then(() => {
  registerWindowIpc()
  registerStoreIpc()
  registerConnectionIpc()
  registerEnvironmentIpc()
  registerIntrospectionIpc()
  registerQueryIpc()
  registerMigrationIpc()
  registerCollectionIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
