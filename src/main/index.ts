import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { alreadyRunningNotice } from './instanceNotice'

/** 이 빌드가 나온 소스 루트 (electron.vite.config.ts 가 박아 넣는다). */
declare const __SOURCE_ROOT__: string
import { registerAllIpc } from './ipc/registry'
import { setDbPath } from './store/db'
import { defaultWindowBounds } from './windowSize'
import { startAiServer, stopAiServer } from './ai/http'
import { setStoreChangeNotifier } from './ai/tools'
import { createKeychainTokenStore } from './ai/tokenStore'

function createWindow(): void {
  // 커서가 있는 화면에 띄운다 — 사용자가 지금 보고 있는 모니터. 위치를 직접 정해야
  // 창이 좁은 모니터에 걸려 폭이 잘리지 않는다(defaultWindowBounds 주석 참고).
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = defaultWindowBounds(target.workArea)
  const mainWindow = new BrowserWindow({
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

/**
 * 실행 중인 인스턴스의 소스 위치를 남기는 쪽지.
 * 병렬 개발에서 두 번째 실행이 "지금 떠 있는 창이 어느 폴더 것인지"를 알려 주기 위해 쓴다.
 * (userData 안 — 워크트리마다 갈리지 않고 하나를 공유하므로 서로를 알아볼 수 있다.)
 */
const INSTANCE_FILE = join(app.getPath('userData'), 'running-instance.txt')

function readRunningSource(): string | null {
  try {
    const p = readFileSync(INSTANCE_FILE, 'utf8').trim()
    return p.length > 0 ? p : null
  } catch {
    return null
  }
}

// 단일 인스턴스 보장 — 로컬 DB·MCP 포트의 소유자를 하나로 유지(둘 뜨면 저장 경합).
if (!app.requestSingleInstanceLock()) {
  // 조용히 죽으면 "창이 떴네" 하고 **남의 워크트리 앱**을 자기 것으로 착각한다(실제 함정).
  console.error(alreadyRunningNotice(__SOURCE_ROOT__, readRunningSource()))
  app.quit()
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  // 내가 잠금을 쥔 인스턴스다 — 어느 소스에서 떴는지 남겨, 뒤에 오는 실행이 알아볼 수 있게.
  try {
    writeFileSync(INSTANCE_FILE, __SOURCE_ROOT__)
  } catch {
    // 못 써도 앱은 정상 동작한다(안내가 덜 친절해질 뿐).
  }
  // 로컬 저장소 DB 경로 주입(userData). getDb() 첫 호출 전에 설정한다.
  setDbPath(join(app.getPath('userData'), 'rockury.db'))
  // 서비스별 IPC 등록부(`ipc/registry.ts`)가 순회한다 — 새 채널이 생겨도 이 진입점은 안 바뀐다.
  registerAllIpc()
  // MCP 서버 — 메인 프로세스 내장(생명주기 한몸). 실패해도 앱 부팅은 계속(내부 재시도).
  // 접속 키는 OS 키체인 암호화 저장 — 디스크에 접속 정보 파일을 남기지 않는다.
  const userData = app.getPath('userData')
  void startAiServer({ dir: userData, appVersion: app.getVersion(), tokenStore: createKeychainTokenStore(userData) })
  // 에이전트(MCP) 쓰기 성공 → 열린 모든 창에 알림 → 렌더러가 해당 스코프만 재조회
  // (tools.ts 는 electron 미의존 테스트 seam 이라 전파를 여기서 주입한다).
  setStoreChangeNotifier((e) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('store:changed', e)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 앱 종료 시 MCP 리스너도 함께 정리(발견 파일의 토큰은 남겨 재사용).
app.on('will-quit', () => {
  void stopAiServer()
  // 실행 중 표식을 거둔다 — 남아 있으면 다음 실행이 "이미 떠 있다"고 잘못 안내한다.
  try {
    rmSync(INSTANCE_FILE, { force: true })
  } catch {
    // 지우지 못해도 다음 실행이 잠금을 얻으면 덮어쓴다.
  }
})
