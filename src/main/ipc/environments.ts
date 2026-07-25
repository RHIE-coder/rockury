import { ipcMain } from 'electron'
import { environmentService } from '../services/environmentService'
import { envelope } from './envelope'

/**
 * Environment(바인딩) IPC(§IA · 결정 B) — (connection × design) 마이그레이션 상태.
 * 접속·연결 테스트는 connections IPC 담당.
 */
export function registerEnvironmentIpc(): void {
  ipcMain.handle('environments:find', (_e, connectionId: string, designId: string) =>
    envelope(() => environmentService.find(connectionId, designId))
  )
  ipcMain.handle('environments:listByConnection', (_e, connectionId: string) =>
    envelope(() => environmentService.listByConnection(connectionId))
  )
  ipcMain.handle('environments:delete', (_e, id: string) =>
    envelope(() => environmentService.remove(id))
  )
  ipcMain.handle('environments:ensure', (_e, connectionId: string, designId: string, targetVersion: string) =>
    envelope(() => environmentService.ensure(connectionId, designId, targetVersion))
  )
  ipcMain.handle('environments:setTarget', (_e, id: string, version: string) =>
    envelope(() => environmentService.setTarget(id, version))
  )
  ipcMain.handle('environments:setApplied', (_e, id: string, version: string) =>
    envelope(() => environmentService.setApplied(id, version))
  )
}
