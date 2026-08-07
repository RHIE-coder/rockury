import { BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { StoreChangedEvent } from '../../shared/storeChanged'
import { envelope, type Envelope } from './envelope'

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

/**
 * 제 채널로 알리는 서비스용 — api·uiux 는 `store:changed` 대신 `api:changed`·`uiux:changed` 를
 * 쓴다(에이전트 쓰기용으로 이미 있던 통로다). 보내는 규칙은 같다: **쓴 창만 뺀다.**
 */
export function notifyPeersOn(channel: string, sender: WebContents, payload: unknown): void {
  const live = BrowserWindow.getAllWindows().map((win) => ({
    win,
    destroyed: win.isDestroyed(),
    webContentsId: win.isDestroyed() ? -1 : win.webContents.id
  }))
  for (const { win } of peerTargets(live, sender.id)) win.webContents.send(channel, payload)
}

/**
 * 저장소를 바꾸는 핸들러를 감싼다 — **성공했을 때만** 다른 창들에 알린다.
 *
 * 목록은 창마다 사본을 들고 시작할 때 한 번만 읽는다. 알림이 없으면 한 창에서 만든 것이 다른
 * 창에 영영 안 뜨고, 그 창에서 편집하면 낡은 값을 통째로 저장해 남의 수정을 지운다.
 *
 * 알림 값이 결과에 딸린 경우(새로 만든 id 등)는 함수로 준다 — 성공 결과를 받아 만든다.
 */
export function writing<T>(
  event: IpcMainInvokeEvent,
  change: StoreChangedEvent | ((data: T) => StoreChangedEvent),
  fn: () => T | Promise<T>
): Promise<Envelope<T>> {
  return envelope(async () => {
    const data = await fn()
    notifyPeers(event.sender, typeof change === 'function' ? change(data) : change)
    return data
  })
}

/**
 * 봉투를 안 쓰는 옛 핸들러용 — 결과를 그대로 돌려주고 알림만 얹는다.
 * (designs·tables·versions 는 봉투 승격 전에 만들어져 raw invoke 그대로다 — `envelope.ts` 머리말.)
 */
export async function writingRaw<T>(
  event: IpcMainInvokeEvent,
  change: StoreChangedEvent | ((data: T) => StoreChangedEvent),
  fn: () => T | Promise<T>
): Promise<T> {
  const data = await fn()
  notifyPeers(event.sender, typeof change === 'function' ? change(data) : change)
  return data
}
