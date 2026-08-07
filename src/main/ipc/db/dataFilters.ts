import { ipcMain } from 'electron'
import { envelope } from '../envelope'
import {
  deleteDataFilter,
  deleteDataFilters,
  listDataFilters,
  listDataFiltersByConnection,
  saveDataFilter
} from '../../store/dataFilters'
import type { SaveFilterInput } from '../../../shared/db/savedFilter'

/** Data 화면의 저장 필터 영속(§db-remote.data.saved-filter). 봉투 규약. */
export function registerDataFilterIpc(): void {
  ipcMain.handle('dataFilters:list', (_e, connectionId: string, schema: string, table: string) =>
    envelope(() => listDataFilters(connectionId, schema, table))
  )
  ipcMain.handle('dataFilters:listByConnection', (_e, connectionId: string) =>
    envelope(() => listDataFiltersByConnection(connectionId))
  )
  ipcMain.handle('dataFilters:save', (_e, input: SaveFilterInput) =>
    envelope(() => saveDataFilter(input))
  )
  ipcMain.handle('dataFilters:delete', (_e, id: string) => envelope(() => deleteDataFilter(id)))
  ipcMain.handle('dataFilters:deleteMany', (_e, ids: string[]) =>
    envelope(() => deleteDataFilters(ids))
  )
}
