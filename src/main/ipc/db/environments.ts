import { ipcMain } from 'electron'
import { environmentService } from '../../services/environmentService'
import { envelope } from '../envelope'
import { writing } from '../peers'

/**
 * Environment(바인딩) IPC(§IA · 결정 B) — (connection × design) 마이그레이션 상태.
 * 접속·연결 테스트는 connections IPC 담당.
 *
 * 바꾸는 것은 `writing` 을 거친다 — 다른 창의 바인딩 목록이 따라온다(`ipc/peers.ts`).
 */
export function registerEnvironmentIpc(): void {
  ipcMain.handle('environments:find', (_e, connectionId: string, designId: string) =>
    envelope(() => environmentService.find(connectionId, designId))
  )
  ipcMain.handle('environments:listByConnection', (_e, connectionId: string) =>
    envelope(() => environmentService.listByConnection(connectionId))
  )
  ipcMain.handle('environments:delete', (e, id: string) =>
    writing(e, { domain: 'environments' }, () => environmentService.remove(id))
  )
  ipcMain.handle('environments:ensure', (e, connectionId: string, designId: string, targetVersion: string) =>
    writing(e, { domain: 'environments' }, () => environmentService.ensure(connectionId, designId, targetVersion))
  )
  ipcMain.handle('environments:setTarget', (e, id: string, version: string) =>
    writing(e, { domain: 'environments' }, () => environmentService.setTarget(id, version))
  )
  ipcMain.handle('environments:setApplied', (e, id: string, version: string) =>
    writing(e, { domain: 'environments' }, () => environmentService.setApplied(id, version))
  )
}
