import { ipcMain } from 'electron'
import {
  environmentService,
  type EnvironmentFormData
} from '../services/environmentService'
import { envelope } from './envelope'

/**
 * 운영부 Environment IPC — 봉투 패턴(`{success,data,error}`) 규약(§ops-plan Phase 0/1).
 * 렌더러는 preload 의 unwrap 을 거쳐 성공 시 data, 실패 시 throw 로 받는다.
 */
export function registerEnvironmentIpc(): void {
  ipcMain.handle('environments:list', (_e, designId: string) =>
    envelope(() => environmentService.list(designId))
  )
  ipcMain.handle('environments:create', (_e, form: EnvironmentFormData) =>
    envelope(() => environmentService.create(form))
  )
  ipcMain.handle('environments:update', (_e, id: string, form: Partial<EnvironmentFormData>) =>
    envelope(() => environmentService.update(id, form))
  )
  ipcMain.handle('environments:delete', (_e, id: string) =>
    envelope(() => environmentService.delete(id))
  )
  ipcMain.handle('environments:setApplied', (_e, id: string, version: string) =>
    envelope(() => environmentService.setApplied(id, version))
  )
  ipcMain.handle('environments:reorder', (_e, orderedIds: string[]) =>
    envelope(() => environmentService.reorder(orderedIds))
  )
  ipcMain.handle('environments:test', (_e, form: EnvironmentFormData) =>
    envelope(() => environmentService.testConnection(form))
  )
  ipcMain.handle('environments:testById', (_e, id: string) =>
    envelope(() => environmentService.testConnectionById(id))
  )
}
