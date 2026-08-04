import { ipcMain } from 'electron'
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject
} from '../store/projects'
import { listScopedItems, setItemProject, type ScopedKind } from '../store/scopedItems'

/**
 * 프로젝트 IPC — 어느 서비스에도 속하지 않는 공용 채널이라 접두어가 `shell:` 이다
 * (창 제어·개발용 화면 피드백과 같은 자리).
 *
 * 서비스 채널과 달리 이 파일은 서비스 에이전트가 건드리지 않는다.
 * 새 채널을 더하면 `src/main/ai/coverage/shell.ts` 에 노출·제외를 등재해야 한다
 * (안 하면 `npm test` 가 막는다).
 */
export function registerProjectsIpc(): void {
  ipcMain.handle('shell:listProjects', () => listProjects())

  ipcMain.handle(
    'shell:createProject',
    (_e, input: { key: string; name: string; description?: string }) => createProject(input)
  )

  ipcMain.handle(
    'shell:updateProject',
    (_e, id: string, patch: { key?: string; name?: string; description?: string }) =>
      updateProject(id, patch)
  )

  ipcMain.handle('shell:deleteProject', (_e, id: string) => deleteProject(id))

  // 소속 편집 — 이미 쌓인 설계·접속을 프로젝트로 나누는 자리(만들 때 정하는 것만으로는 안 된다).
  ipcMain.handle('shell:listScopedItems', () => listScopedItems())
  ipcMain.handle(
    'shell:setItemProject',
    (_e, kind: ScopedKind, id: string, projectId: string | null) =>
      setItemProject(kind, id, projectId)
  )
}
