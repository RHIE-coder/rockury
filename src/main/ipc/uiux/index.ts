import { BrowserWindow } from 'electron'
import { registerUiuxSpecsIpc } from './specs'
import { setUiuxChangeNotifier } from '../../ai/uiuxTools'

/**
 * UI/UX 서비스의 IPC 채널.
 *
 * 채널 접두어는 서비스 id(`uiux:`) — AGENTS.md 네임스페이스 규칙.
 * 새 주제를 더할 때: 여기에 `<주제>.ts` 를 만들고 아래에서 부르고,
 * `src/main/ai/coverage/uiux.ts` 에 노출·제외를 등재한다(안 하면 `npm test` 실패).
 * `src/main/index.ts` 나 다른 서비스 폴더는 건드리지 않는다.
 */
export function registerUiuxIpc(): void {
  registerUiuxSpecsIpc()

  // MCP 쓰기 → 열린 화면이 따라오게 한다(spec `uiux-ia.md` §8).
  // 창 전파를 공용 진입점(`main/index.ts`)이 아니라 여기서 거는 이유는 API 서비스와 같다 —
  // 그 파일은 새 서비스를 만들 때만 바뀌는 공용 파일이라, 등록 시점에 우리 쪽에서 주입한다.
  setUiuxChangeNotifier((e) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('uiux:changed', e)
  })
}
