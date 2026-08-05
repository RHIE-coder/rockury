import { app, BaseWindow, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * 앱 메뉴 — **탭·창 단축키를 여기서 쥔다**(2026-08-05).
 *
 * 왜 화면(렌더러)에서 키를 안 받나: 메뉴를 안 세우면 Electron 의 기본 메뉴가 붙는데, 거기 이미
 * `⌘W`(창 닫기)가 있어서 화면의 키 처리보다 **먼저** 먹는다 — 탭을 닫으려는데 창이 닫힌다.
 * 그렇다고 메뉴를 통째로 없애면(`setApplicationMenu(null)`) macOS 에서 복사·붙여넣기·전체선택이
 * 같이 죽는다. 그래서 **표준 항목은 role 로 그대로 두고** 탭 항목만 더한다.
 *
 * 창은 테두리가 없어서(`frame: false`) 이 메뉴는 화면에 안 보인다 — macOS 의 화면 위 메뉴 막대에만
 * 선다. 윈도우·리눅스에서는 막대가 안 그려지고 단축키만 산다.
 */

/** 메뉴가 화면에 시키는 일. 렌더러의 `shell/windowCommands` 가 받아 스토어를 움직인다. */
export type WindowCommand =
  | 'new-tab'
  | 'close-tab'
  | 'new-window'
  | 'next-tab'
  | 'prev-tab'
  | `select-tab:${number}`

/**
 * 명령을 **한 창에만** 보낸다 — 창이 여럿이라 전부에 뿌리면 안 보고 있던 창에도 탭이 생긴다.
 *
 * 어느 창인가: Electron 이 메뉴를 누를 때 대상 창을 함께 준다(`from`). 그것이 없을 때만 초점을
 * 따진다 — 초점으로만 찾으면 아무 창도 초점을 안 쥔 순간에 명령이 조용히 사라진다(실측: 자동
 * 검사에서 메뉴가 먹다 안 먹다 했다).
 */
function send(command: WindowCommand, from?: BaseWindow): void {
  // 메뉴가 주는 것은 넓은 쪽 타입(BaseWindow)이라 화면이 달린 창인지 좁혀서 쓴다.
  const target = from instanceof BrowserWindow ? from : null
  const win = target ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('window:command', command)
}

function tabMenu(): MenuItemConstructorOptions {
  const jumps: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    // 아홉째(⌘9)는 브라우저와 같게 **마지막 탭**으로 간다 — 탭이 아홉보다 많을 때 끝으로 가는 길.
    label: i === 8 ? '마지막 탭' : `${i + 1}번째 탭`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: (_item, win) => send(`select-tab:${i}`, win)
  }))

  return {
    label: '탭',
    submenu: [
      { label: '새 탭', accelerator: 'CmdOrCtrl+T', click: (_i, w) => send('new-tab', w) },
      { label: '새 창', accelerator: 'CmdOrCtrl+N', click: (_i, w) => send('new-window', w) },
      { type: 'separator' },
      { label: '다음 탭', accelerator: 'Control+Tab', click: (_i, w) => send('next-tab', w) },
      { label: '이전 탭', accelerator: 'Control+Shift+Tab', click: (_i, w) => send('prev-tab', w) },
      ...jumps,
      { type: 'separator' },
      // 탭 닫기가 `⌘W` 를 가져간다 — 브라우저와 같은 자리다. 마지막 한 장이면 창을 닫고,
      // 마지막 창의 마지막 탭이면 아무것도 안 한다(키 하나로 앱이 꺼지지 않게 · 렌더러가 판정).
      { label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: (_i, w) => send('close-tab', w) },
      { role: 'minimize', label: '창 최소화' },
      { role: 'togglefullscreen', label: '전체 화면 전환' }
    ]
  }
}

export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    // macOS 의 앱 메뉴(종료·서비스·가리기)는 role 로 통째로 받는다 — 손으로 쓰면 ⌘Q 를 잃는다.
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const, label: app.getName() }]
      : []),
    // 복사·붙여넣기·전체선택·실행취소가 여기 산다. 이걸 빼면 입력칸에서 ⌘C 가 안 먹는다.
    { role: 'editMenu', label: '편집' },
    tabMenu(),
    {
      label: '보기',
      submenu: [
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        // 새로고침·개발자 도구는 개발 중에만 — 배포본에서 사용자가 눌러 좋을 것이 없다.
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' as const },
              { role: 'reload' as const, label: '새로고침' },
              { role: 'toggleDevTools' as const, label: '개발자 도구' }
            ])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
