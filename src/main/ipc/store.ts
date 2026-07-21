import { ipcMain } from 'electron'
import {
  createDesign,
  deleteDesign,
  listDesigns,
  updateDesign,
  type CreateDesignInput
} from '../store/designs'
import { listTables, replaceAllTables, type TableRecord } from '../store/tables'
import { createVersion, listVersions, type CreateVersionInput } from '../store/versions'

/**
 * 로컬 메타 저장소 IPC — 렌더러가 preload(window.rockury.*)를 통해 호출한다.
 * invoke/handle(비동기 요청-응답)로 데이터를 주고받는다.
 */
export function registerStoreIpc(): void {
  ipcMain.handle('designs:list', () => listDesigns())
  ipcMain.handle('designs:create', (_event, input: CreateDesignInput) => createDesign(input))
  ipcMain.handle('designs:update', (_event, id: string, patch: { name: string; description: string }) =>
    updateDesign(id, patch)
  )
  ipcMain.handle('designs:delete', (_event, id: string) => deleteDesign(id))

  ipcMain.handle('tables:list', () => listTables())
  ipcMain.handle('tables:replaceAll', (_event, records: TableRecord[]) => replaceAllTables(records))

  ipcMain.handle('versions:list', (_event, designId: string) => listVersions(designId))
  ipcMain.handle('versions:create', (_event, input: CreateVersionInput) => createVersion(input))
}
