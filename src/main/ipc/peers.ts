import { BrowserWindow, type WebContents } from 'electron'
import type { StoreChangedEvent } from '../../shared/storeChanged'

/**
 * 화면발 쓰기를 **다른 창들에** 알린다 — 그 창들은 해당 목록을 다시 읽는다.
 *
 * 쓴 창에는 안 보낸다. 그 창은 이미 낙관 반영으로 화면을 고쳤고, 되받으면 제 쓰기를 한 번 더
 * 되씹는다(spec ai-server tools.rehydration AC-3 "자기 메아리 금지"). 보내는 쪽을 IPC 이벤트의
 * `sender` 로 가르므로, 부르는 자리는 반드시 핸들러 안이어야 한다.
 */

/** 받을 창 고르기 — electron 을 모르는 순수 함수라 단위 테스트로 덮인다. */
export function peerTargets<T extends { destroyed: boolean; webContentsId: number }>(
  windows: readonly T[],
  senderId: number
): T[] {
  return windows.filter((w) => !w.destroyed && w.webContentsId !== senderId)
}

export function notifyPeers(sender: WebContents, e: StoreChangedEvent): void {
  const live = BrowserWindow.getAllWindows().map((win) => ({
    win,
    destroyed: win.isDestroyed(),
    webContentsId: win.isDestroyed() ? -1 : win.webContents.id
  }))
  for (const { win } of peerTargets(live, sender.id)) win.webContents.send('store:changed', e)
}
