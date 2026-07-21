import { ipcMain } from 'electron'
import { connectionService, type ConnectionFormData } from '../services/connectionService'
import { envelope } from './envelope'

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
  ipcMain.handle('connections:test', (_e, form: ConnectionFormData) =>
    envelope(() => connectionService.testConnection(form))
  )
  ipcMain.handle('connections:testById', (_e, id: string) =>
    envelope(() => connectionService.testConnectionById(id))
  )
}
