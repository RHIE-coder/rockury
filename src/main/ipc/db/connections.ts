import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { connectionService, type ConnectionFormData } from '../../services/connectionService'
import { createSample, resetSample, sampleStatus } from '../../store/sampleDb'
import { envelope, type Envelope } from '../envelope'
import { notifyPeers } from '../peers'

/**
 * Connection IPC(§IA · 결정 B) — 원시 접속 CRUD + 연결 테스트(봉투 패턴).
 * 설계와 무관 — Remote 가 이걸로 실 DB 를 조회한다.
 */

/**
 * 목록을 바꾸는 핸들러 — 성공했을 때만 **다른 창들에** 알린다(그 창들이 목록을 다시 읽는다).
 *
 * 접속 목록은 창마다 사본을 들고 시작 때 한 번만 읽는다. 알림이 없으면 한 창에서 만든 접속이
 * 다른 창에 영영 안 뜨고, 그 창에서 편집하면 낡은 폼을 통째로 저장해 남의 수정을 지운다.
 */
function writing<T>(e: IpcMainInvokeEvent, fn: () => T | Promise<T>): Promise<Envelope<T>> {
  return envelope(async () => {
    const data = await fn()
    notifyPeers(e.sender, { domain: 'connections' })
    return data
  })
}

export function registerConnectionIpc(): void {
  ipcMain.handle('connections:list', () => envelope(() => connectionService.list()))
  ipcMain.handle('connections:create', (e, form: ConnectionFormData) =>
    writing(e, () => connectionService.create(form))
  )
  ipcMain.handle('connections:update', (e, id: string, form: Partial<ConnectionFormData>) =>
    writing(e, () => connectionService.update(id, form))
  )
  ipcMain.handle('connections:delete', (e, id: string) =>
    writing(e, () => connectionService.delete(id))
  )
  ipcMain.handle('connections:reorder', (e, orderedIds: string[]) =>
    writing(e, () => connectionService.reorder(orderedIds))
  )
  ipcMain.handle('connections:move', (e, id: string, groupId: string | null, orderedIds: string[]) =>
    writing(e, () => connectionService.move(id, groupId, orderedIds))
  )
  // 그룹(접속 카드 분류) CRUD — 삭제 시 소속 연결은 미분류로.
  ipcMain.handle('connectionGroups:list', () => envelope(() => connectionService.listGroups()))
  ipcMain.handle('connectionGroups:create', (e, name: string) =>
    writing(e, () => connectionService.createGroup(name))
  )
  ipcMain.handle('connectionGroups:rename', (e, id: string, name: string) =>
    writing(e, () => connectionService.renameGroup(id, name))
  )
  ipcMain.handle('connectionGroups:reorder', (e, orderedIds: string[]) =>
    writing(e, () => connectionService.reorderGroups(orderedIds))
  )
  ipcMain.handle('connectionGroups:delete', (e, id: string) =>
    writing(e, () => connectionService.deleteGroup(id))
  )
  ipcMain.handle('connections:test', (_e, form: ConnectionFormData) =>
    envelope(() => connectionService.testConnection(form))
  )
  ipcMain.handle('connections:testById', (_e, id: string) =>
    envelope(() => connectionService.testConnectionById(id))
  )
  ipcMain.handle('connections:revealPassword', (_e, id: string) =>
    envelope(() => connectionService.revealPassword(id))
  )

  // ── 샘플 DB — 준비물 없이 앱을 곧장 써 보게 하는 SQLite 하나. userData 아래에만 쓴다. ──
  ipcMain.handle('connections:sampleStatus', () =>
    envelope(() => sampleStatus(app.getPath('userData')))
  )
  // 샘플 만들기·되만들기는 접속 레코드를 건드린다 — 목록이 바뀌므로 다른 창도 따라와야 한다.
  ipcMain.handle('connections:createSample', (e) =>
    writing(e, () => createSample(app.getPath('userData')))
  )
  ipcMain.handle('connections:resetSample', (e) =>
    writing(e, () => resetSample(app.getPath('userData')))
  )
}
