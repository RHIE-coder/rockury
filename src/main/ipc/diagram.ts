import { ipcMain } from 'electron'
import { envelope } from './envelope'
import { clearLayout, getLayout, saveLayout, type SaveLayoutInput } from '../store/diagramLayouts'

/** Console 실 ERD 레이아웃 영속(§ops-plan 2e · v2). 봉투 규약. */
export function registerDiagramIpc(): void {
  ipcMain.handle('diagram:getLayout', (_e, connectionId: string) =>
    envelope(() => getLayout(connectionId))
  )
  ipcMain.handle('diagram:saveLayout', (_e, input: SaveLayoutInput) =>
    envelope(() => saveLayout(input))
  )
  ipcMain.handle('diagram:clearLayout', (_e, connectionId: string) =>
    envelope(() => clearLayout(connectionId))
  )
}
