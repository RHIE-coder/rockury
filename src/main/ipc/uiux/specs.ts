import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  createNode,
  createNote,
  createVersion,
  deleteNode,
  deleteNote,
  deleteVersion,
  getProjectTokens,
  getTree,
  getVersion,
  listNotes,
  listProjects,
  listVersions,
  saveSurfaceContent,
  setNoteResolved,
  setProjectTokens,
  setSurfaceStatus,
  updateNode,
  type NodeInput,
  type SpecLevel
} from '../../store/uiuxSpecs'
import type { UiuxChangedEvent } from '../../ai/uiuxTools'
import { notifyPeersOn } from '../peers'

/**
 * UI/UX 설계 저장소 IPC
 *
 * 층(Project·Application·Service·Surface)마다 채널을 따로 두지 않고 `level` 인자로 가른다 —
 * 층이 넷인데 CRUD 를 각각 열면 채널이 12개가 되고, 규칙(주소 유일성·연쇄 삭제)이 흩어진다.
 * 봉투(Envelope)를 쓰지 않는 것은 설계부 채널 규약이다(운영부만 봉투 — `preload/envelope.ts`).
 */
export function registerUiuxSpecsIpc(): void {
  /**
   * 쓰기 하나 — 성공하면 **다른 창들**에 `uiux:changed` 를 보낸다(에이전트 쓰기가 쓰던 통로 그대로).
   * 안 보내면 창마다 시작할 때 읽은 나무가 영영 안 맞는다(`ipc/peers.ts` 머리말).
   */
  const write = async <T>(
    event: IpcMainInvokeEvent,
    at: UiuxChangedEvent,
    run: () => T | Promise<T>
  ): Promise<T> => {
    const data = await run()
    notifyPeersOn('uiux:changed', event.sender, at)
    return data
  }

  ipcMain.handle('uiux:listProjects', () => listProjects())
  ipcMain.handle('uiux:getTree', (_e, projectId: string) => getTree(projectId))

  ipcMain.handle('uiux:createNode', (e, level: SpecLevel, parentId: string | null, input: NodeInput) =>
    write(e, { domain: 'nodes' }, () => createNode(level, parentId, input))
  )
  ipcMain.handle(
    'uiux:updateNode',
    (e, level: SpecLevel, id: string, patch: { name?: string; description?: string; kind?: string; key?: string }) =>
      write(e, { domain: 'nodes' }, () => updateNode(level, id, patch))
  )
  ipcMain.handle('uiux:deleteNode', (e, level: SpecLevel, id: string) =>
    write(e, { domain: 'nodes' }, () => deleteNode(level, id))
  )

  ipcMain.handle('uiux:saveSurface', (e, id: string, content: string) =>
    write(e, { domain: 'surface' }, () => saveSurfaceContent(id, content))
  )
  ipcMain.handle('uiux:setSurfaceStatus', (e, id: string, status: string, by: string, note: string) =>
    write(e, { domain: 'status' }, () => setSurfaceStatus(id, status, by, note))
  )

  // 의견(핀) — 화면 위 요소에 붙는 메모. 스크린샷에 화살표를 그려 보내던 일을 대신한다.
  ipcMain.handle('uiux:listNotes', (_e, surfaceId: string) => listNotes(surfaceId))
  ipcMain.handle(
    'uiux:createNote',
    (e, input: { surfaceId: string; target?: string; body: string; author?: string }) =>
      write(e, { domain: 'notes' }, () => createNote(input))
  )
  ipcMain.handle('uiux:setNoteResolved', (e, id: string, resolved: boolean) =>
    write(e, { domain: 'notes' }, () => setNoteResolved(id, resolved))
  )
  ipcMain.handle('uiux:deleteNote', (e, id: string) =>
    write(e, { domain: 'notes' }, () => deleteNote(id))
  )

  // 디자인 토큰 — 기본 한 벌 위에 프로젝트가 덮어쓰는 값만 오간다.
  ipcMain.handle('uiux:getTokens', (_e, projectId: string) => getProjectTokens(projectId))
  ipcMain.handle('uiux:setTokens', (e, projectId: string, tokens: Record<string, string>) =>
    write(e, { domain: 'tokens', projectId }, () => setProjectTokens(projectId, tokens))
  )

  // 버전 — 지금 설계를 통째로 굳힌 스냅샷.
  ipcMain.handle('uiux:listVersions', (_e, projectId: string) => listVersions(projectId))
  ipcMain.handle('uiux:getVersion', (_e, id: string) => getVersion(id))
  ipcMain.handle(
    'uiux:createVersion',
    (e, input: { projectId: string; number: string; note?: string; snapshot: string }) =>
      write(e, { domain: 'nodes', projectId: input.projectId }, () => createVersion(input))
  )
  ipcMain.handle('uiux:deleteVersion', (e, id: string) =>
    write(e, { domain: 'nodes' }, () => deleteVersion(id))
  )
}
