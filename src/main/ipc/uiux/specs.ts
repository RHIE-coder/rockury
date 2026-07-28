import { ipcMain } from 'electron'
import {
  createNode,
  createNote,
  deleteNode,
  deleteNote,
  getProjectTokens,
  getTree,
  listNotes,
  listProjects,
  saveSurfaceContent,
  setNoteResolved,
  setProjectTokens,
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

  // 의견(핀) — 화면 위 요소에 붙는 메모. 스크린샷에 화살표를 그려 보내던 일을 대신한다.
  ipcMain.handle('uiux:listNotes', (_e, surfaceId: string) => listNotes(surfaceId))
  ipcMain.handle(
    'uiux:createNote',
    (_e, input: { surfaceId: string; target?: string; body: string; author?: string }) => createNote(input)
  )
  ipcMain.handle('uiux:setNoteResolved', (_e, id: string, resolved: boolean) => setNoteResolved(id, resolved))
  ipcMain.handle('uiux:deleteNote', (_e, id: string) => deleteNote(id))

  // 디자인 토큰 — 기본 한 벌 위에 프로젝트가 덮어쓰는 값만 오간다.
  ipcMain.handle('uiux:getTokens', (_e, projectId: string) => getProjectTokens(projectId))
  ipcMain.handle('uiux:setTokens', (_e, projectId: string, tokens: Record<string, string>) =>
    setProjectTokens(projectId, tokens)
  )
}
