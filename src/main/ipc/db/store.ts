import { ipcMain } from 'electron'
import {
  createDesign,
  deleteDesign,
  listDesigns,
  updateDesign,
  type CreateDesignInput
} from '../../store/designs'
import { listTables, replaceTablesForDesign, type TableRecord } from '../../store/tables'
import { listSeedSets, replaceSeedSetsForDesign, type SeedSetRecord } from '../../store/seedSets'
import {
  deleteEnvVariable,
  listEnvVariables,
  resolveEnvVariables,
  setEnvVariable
} from '../../store/envVariables'
import { createVersion, deleteVersion, listVersions, type CreateVersionInput } from '../../store/versions'

/**
 * 로컬 메타 저장소 IPC — 렌더러가 preload(window.rockury.*)를 통해 호출한다.
 * invoke/handle(비동기 요청-응답)로 데이터를 주고받는다.
 */
export function registerStoreIpc(): void {
  ipcMain.handle('designs:list', () => listDesigns())
  ipcMain.handle('designs:create', (_event, input: CreateDesignInput) => createDesign(input))
  ipcMain.handle(
    'designs:update',
    (_event, id: string, patch: { name?: string; description?: string; schemas?: string[] }) =>
      updateDesign(id, patch)
  )
  ipcMain.handle('designs:delete', (_event, id: string) => deleteDesign(id))

  ipcMain.handle('tables:list', () => listTables())
  // 설계 스코프 저장 — 전량 교체(tables:replaceAll)는 제거됨(spec ai-server 쓰기 경합 차단).
  ipcMain.handle('tables:replaceForDesign', (_event, designId: string, records: TableRecord[]) =>
    replaceTablesForDesign(designId, records)
  )

  // Design › Seed — 시드 세트도 tables 와 같은 설계 스코프 규칙으로 저장한다.
  ipcMain.handle('seedSets:list', () => listSeedSets())
  ipcMain.handle('seedSets:replaceForDesign', (_event, designId: string, records: SeedSetRecord[]) =>
    replaceSeedSetsForDesign(designId, records)
  )

  // 환경 변수 값 — 목록은 평문을 싣지 않고, 평문은 반영 직전 resolve 로만 나간다.
  ipcMain.handle('envVars:list', (_event, envId: string) => listEnvVariables(envId))
  ipcMain.handle('envVars:set', (_event, envId: string, name: string, value: string) =>
    setEnvVariable(envId, name, value)
  )
  ipcMain.handle('envVars:delete', (_event, envId: string, name: string) => deleteEnvVariable(envId, name))
  ipcMain.handle('envVars:resolve', (_event, envId: string) => resolveEnvVariables(envId))

  ipcMain.handle('versions:list', (_event, designId: string) => listVersions(designId))
  ipcMain.handle('versions:create', (_event, input: CreateVersionInput) => createVersion(input))
  ipcMain.handle('versions:delete', (_event, id: string) => deleteVersion(id))
}
