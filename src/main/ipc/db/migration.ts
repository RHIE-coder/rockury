import { ipcMain } from 'electron'
import {
  appendLog,
  latestSnapshot,
  listLogs,
  saveSnapshot,
  type CreateLogInput,
  type CreateSnapshotInput
} from '../../store/migration'
import { envelope } from '../envelope'

/**
 * Migration IPC(§ops-plan Phase 3) — 스냅샷 기준선 + 로그 체인(봉투 패턴).
 * Drift/Plan/Run 오케스트레이션은 렌더러(introspection+diff+ddlDiff+query 재사용)가 담당.
 */
export function registerMigrationIpc(): void {
  ipcMain.handle('migration:saveSnapshot', (_e, input: CreateSnapshotInput) =>
    envelope(() => saveSnapshot(input))
  )
  ipcMain.handle('migration:latestSnapshot', (_e, envId: string) =>
    envelope(() => latestSnapshot(envId))
  )
  ipcMain.handle('migration:appendLog', (_e, input: CreateLogInput) => envelope(() => appendLog(input)))
  ipcMain.handle('migration:listLogs', (_e, envId: string) => envelope(() => listLogs(envId)))
}
