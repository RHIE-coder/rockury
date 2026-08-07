import { ipcMain } from 'electron'
import { envelope } from '../envelope'
import { writing } from '../peers'
import { clearLayout, getLayout, saveLayout, type SaveLayoutInput } from '../../store/diagramLayouts'

/** Remote 실 ERD 레이아웃 영속(§ops-plan 2e · v2). 봉투 규약. */
export function registerDiagramIpc(): void {
  ipcMain.handle('diagram:getLayout', (_e, connectionId: string) =>
    envelope(() => getLayout(connectionId))
  )
  ipcMain.handle('diagram:saveLayout', (e, input: SaveLayoutInput) =>
    writing(e, { domain: 'diagram' }, () => saveLayout(input))
  )
  ipcMain.handle('diagram:clearLayout', (e, connectionId: string) =>
    writing(e, { domain: 'diagram' }, () => clearLayout(connectionId))
  )
}
