import { app, BrowserWindow } from 'electron'
import { registerApiSpecIpc } from './specs'
import { registerApiOpsIpc } from './ops'
import { registerApiStreamIpc, shutdownApiStreams } from './stream'
import { registerApiInboxIpc } from './inbox'
import { registerApiMockIpc } from './mocking'
import { registerApiContractIpc } from './contract'
import { registerApiTransferIpc } from './transfer'
import { setApiChangeNotifier } from '../../ai/apiTools'

/**
 * API 서비스의 IPC 채널.
 *
 * 새 채널을 만들 때는 이 폴더 안에서만 움직인다 — `src/main/index.ts` 나 다른 서비스
 * 폴더는 건드리지 않는다(AGENTS.md 병렬 개발 파일 소유권).
 * 새 채널은 `src/main/ai/coverage/api.ts` 에 노출 또는 제외로 등재해야 `npm test` 를 통과한다.
 */
export function registerApiIpc(): void {
  registerApiSpecIpc()
  registerApiOpsIpc()
  registerApiStreamIpc()
  registerApiInboxIpc()
  registerApiMockIpc()
  registerApiContractIpc()
  registerApiTransferIpc()

  // 열린 소켓을 앱 종료에 남기지 않는다. 여기서 거는 이유는 아래 알림 주입과 같다 —
  // 공용 진입점(main/index.ts)을 안 건드리려고 우리 등록 시점에 붙인다.
  app.on('before-quit', shutdownApiStreams)

  // MCP 쓰기 → 열린 화면이 따라오게 한다(spec api-mcp tools.write AC-8).
  // 창 전파를 공용 진입점(main/index.ts)이 아니라 여기서 거는 이유: 그 파일은 새 서비스를
  // 만들 때만 바뀌는 공용 파일이다. 등록 시점에 우리 쪽에서 주입하면 손댈 일이 없다.
  setApiChangeNotifier((e) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('api:changed', e)
  })
}
