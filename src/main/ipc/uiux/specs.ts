import { ipcMain } from 'electron'
import {
  createNode,
  deleteNode,
  getTree,
  listProjects,
  saveSurfaceContent,
  setSurfaceStatus,
  updateNode,
  type NodeInput,
  type SpecLevel
} from '../../store/uiuxSpecs'

/**
 * UI/UX 설계 저장소 IPC — 명세 정본 `docs/spec/uiux-ia.md` §7.
 *
 * 층(Project·Application·Service·Surface)마다 채널을 따로 두지 않고 `level` 인자로 가른다 —
 * 층이 넷인데 CRUD 를 각각 열면 채널이 12개가 되고, 규칙(주소 유일성·연쇄 삭제)이 흩어진다.
 * 봉투(Envelope)를 쓰지 않는 것은 설계부 채널 규약이다(운영부만 봉투 — `preload/envelope.ts`).
 */
export function registerUiuxSpecsIpc(): void {
  ipcMain.handle('uiux:listProjects', () => listProjects())
  ipcMain.handle('uiux:getTree', (_e, projectId: string) => getTree(projectId))

  ipcMain.handle('uiux:createNode', (_e, level: SpecLevel, parentId: string | null, input: NodeInput) =>
    createNode(level, parentId, input)
  )
  ipcMain.handle(
    'uiux:updateNode',
    (_e, level: SpecLevel, id: string, patch: { name?: string; description?: string; kind?: string; key?: string }) =>
      updateNode(level, id, patch)
  )
  ipcMain.handle('uiux:deleteNode', (_e, level: SpecLevel, id: string) => deleteNode(level, id))

  ipcMain.handle('uiux:saveSurface', (_e, id: string, content: string) => saveSurfaceContent(id, content))
  ipcMain.handle('uiux:setSurfaceStatus', (_e, id: string, status: string, by: string, note: string) =>
    setSurfaceStatus(id, status, by, note)
  )
}
