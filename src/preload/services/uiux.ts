import { ipcRenderer } from 'electron'
import type {
  NodeInput,
  SpecLevel,
  SpecNoteRow,
  SpecProjectRow,
  SpecTree
} from '../../main/store/uiuxSpecs'

// 메인 프로세스 타입을 렌더러 쪽으로 그대로 통과시킨다 — 화면이 main 을 직접 import 하지 않게.
export type { NodeInput, SpecLevel, SpecNoteRow, SpecProjectRow, SpecTree }

/**
 * UI/UX 서비스가 렌더러에 여는 창구.
 *
 * 최상위 키를 **서비스 id 그대로**(`uiux`) 쓴다 — 다른 서비스와 겹칠 수 없는 유일한 이름이고,
 * 화면에서 `window.rockury.uiux.…` 를 보면 어느 서비스 창구인지 즉시 읽힌다.
 * 설계부 채널이라 봉투(Envelope)를 쓰지 않는다 — 실패하면 그대로 reject 된다.
 */
export const uiuxApi = {
  uiux: {
    listProjects: (): Promise<SpecProjectRow[]> => ipcRenderer.invoke('uiux:listProjects'),
    getTree: (projectId: string): Promise<SpecTree> => ipcRenderer.invoke('uiux:getTree', projectId),

    createNode: (level: SpecLevel, parentId: string | null, input: NodeInput): Promise<{ id: string }> =>
      ipcRenderer.invoke('uiux:createNode', level, parentId, input),
    updateNode: (
      level: SpecLevel,
      id: string,
      patch: { name?: string; description?: string; kind?: string; key?: string }
    ): Promise<void> => ipcRenderer.invoke('uiux:updateNode', level, id, patch),
    deleteNode: (level: SpecLevel, id: string): Promise<void> =>
      ipcRenderer.invoke('uiux:deleteNode', level, id),

    saveSurface: (id: string, content: string): Promise<void> =>
      ipcRenderer.invoke('uiux:saveSurface', id, content),
    setSurfaceStatus: (id: string, status: string, by: string, note: string): Promise<void> =>
      ipcRenderer.invoke('uiux:setSurfaceStatus', id, status, by, note),

    listNotes: (surfaceId: string): Promise<SpecNoteRow[]> =>
      ipcRenderer.invoke('uiux:listNotes', surfaceId),
    createNote: (input: {
      surfaceId: string
      target?: string
      body: string
      author?: string
    }): Promise<{ id: string }> => ipcRenderer.invoke('uiux:createNote', input),
    setNoteResolved: (id: string, resolved: boolean): Promise<void> =>
      ipcRenderer.invoke('uiux:setNoteResolved', id, resolved),
    deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('uiux:deleteNote', id)
  }
}
