import { ipcMain } from 'electron'
import { connectionService, type ConnectionFormData } from '../../services/connectionService'
import { envelope } from '../envelope'

/**
 * Connection IPC(§IA · 결정 B) — 원시 접속 CRUD + 연결 테스트(봉투 패턴).
 * 설계와 무관 — Console 이 이걸로 실 DB 를 조회한다.
 */
export function registerConnectionIpc(): void {
  ipcMain.handle('connections:list', () => envelope(() => connectionService.list()))
  ipcMain.handle('connections:create', (_e, form: ConnectionFormData) =>
    envelope(() => connectionService.create(form))
  )
  ipcMain.handle('connections:update', (_e, id: string, form: Partial<ConnectionFormData>) =>
    envelope(() => connectionService.update(id, form))
  )
  ipcMain.handle('connections:delete', (_e, id: string) =>
    envelope(() => connectionService.delete(id))
  )
  ipcMain.handle('connections:reorder', (_e, orderedIds: string[]) =>
    envelope(() => connectionService.reorder(orderedIds))
  )
  ipcMain.handle('connections:move', (_e, id: string, groupId: string | null, orderedIds: string[]) =>
    envelope(() => connectionService.move(id, groupId, orderedIds))
  )
  // 그룹(접속 카드 분류) CRUD — 삭제 시 소속 연결은 미분류로.
  ipcMain.handle('connectionGroups:list', () => envelope(() => connectionService.listGroups()))
  ipcMain.handle('connectionGroups:create', (_e, name: string) =>
    envelope(() => connectionService.createGroup(name))
  )
  ipcMain.handle('connectionGroups:rename', (_e, id: string, name: string) =>
    envelope(() => connectionService.renameGroup(id, name))
  )
  ipcMain.handle('connectionGroups:reorder', (_e, orderedIds: string[]) =>
    envelope(() => connectionService.reorderGroups(orderedIds))
  )
  ipcMain.handle('connectionGroups:delete', (_e, id: string) =>
    envelope(() => connectionService.deleteGroup(id))
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
}
