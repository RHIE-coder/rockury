import {
  createColumnSet,
  deleteColumnSet,
  listColumnSets,
  type ColumnSetColumn
} from '../../store/columnSets'
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
import { createVersion, deleteVersion, listVersions, updateVersionNote, type CreateVersionInput } from '../../store/versions'
import { writingRaw } from '../peers'

/**
 * 로컬 메타 저장소 IPC — 렌더러가 preload(window.rockury.*)를 통해 호출한다.
 * invoke/handle(비동기 요청-응답)로 데이터를 주고받는다.
 *
 * 쓰기는 전부 `writingRaw` 를 거친다 — 성공하면 **다른 창들**이 그 스코프만 다시 읽는다
 * (`ipc/peers.ts`). 봉투를 안 쓰는 옛 핸들러라 raw 쪽을 쓴다.
 */
export function registerStoreIpc(): void {
  ipcMain.handle('designs:list', () => listDesigns())
  ipcMain.handle('designs:create', (event, input: CreateDesignInput) =>
    writingRaw(event, (d) => ({ domain: 'designs', designId: d.id }), () => createDesign(input))
  )
  ipcMain.handle(
    'designs:update',
    (
      event,
      id: string,
      patch: {
        name?: string
        description?: string
        schemas?: string[]
        declaredSchemas?: string[]
        projectId?: string | null
      }
    ) => writingRaw(event, { domain: 'designs', designId: id }, () => updateDesign(id, patch))
  )
  ipcMain.handle('designs:delete', (event, id: string) =>
    writingRaw(event, { domain: 'designs', designId: id }, () => deleteDesign(id))
  )

  ipcMain.handle('tables:list', () => listTables())
  // 설계 스코프 저장 — 전량 교체(tables:replaceAll)는 제거됨(spec ai-server 쓰기 경합 차단).
  ipcMain.handle('tables:replaceForDesign', (event, designId: string, records: TableRecord[]) =>
    writingRaw(event, { domain: 'tables', designId }, () => replaceTablesForDesign(designId, records))
  )

  // Design › Seed — 시드 세트도 tables 와 같은 설계 스코프 규칙으로 저장한다.
  ipcMain.handle('seedSets:list', () => listSeedSets())
  ipcMain.handle('seedSets:replaceForDesign', (event, designId: string, records: SeedSetRecord[]) =>
    writingRaw(event, { domain: 'seeds', designId }, () => replaceSeedSetsForDesign(designId, records))
  )

  /*
   * 컬럼 묶음 — 설계에 안 매인다(재활용이 존재 이유). 그래서 `writingRaw` 로 감싸지 않는다:
   * 설계 스코프 알림(어느 설계가 바뀌었나)을 보낼 대상이 없다.
   */
  ipcMain.handle('columnSets:list', () => listColumnSets())
  ipcMain.handle('columnSets:create', (_event, name: string, columns: ColumnSetColumn[]) =>
    createColumnSet(name, columns)
  )
  ipcMain.handle('columnSets:delete', (_event, id: string) => deleteColumnSet(id))

  // 환경 변수 값 — 목록은 평문을 싣지 않고, 평문은 반영 직전 resolve 로만 나간다.
  ipcMain.handle('envVars:list', (_event, envId: string) => listEnvVariables(envId))
  ipcMain.handle('envVars:set', (event, envId: string, name: string, value: string) =>
    writingRaw(event, { domain: 'environments' }, () => setEnvVariable(envId, name, value))
  )
  ipcMain.handle('envVars:delete', (event, envId: string, name: string) =>
    writingRaw(event, { domain: 'environments' }, () => deleteEnvVariable(envId, name))
  )
  ipcMain.handle('envVars:resolve', (_event, envId: string) => resolveEnvVariables(envId))

  ipcMain.handle('versions:list', (_event, designId: string) => listVersions(designId))
  ipcMain.handle('versions:create', (event, input: CreateVersionInput) =>
    writingRaw(event, { domain: 'versions', designId: input.designId }, () => createVersion(input))
  )
  ipcMain.handle('versions:delete', (event, id: string) =>
    // 버전은 id 로만 지운다 — 어느 설계였는지는 지우기 전에 찾아 둔다(지운 뒤엔 못 찾는다).
    writingRaw(
      event,
      { domain: 'versions', designId: designIdOfVersion(id) },
      () => deleteVersion(id)
    )
  )
  ipcMain.handle('versions:updateNote', (event, id: string, note: string) =>
    writingRaw(
      event,
      { domain: 'versions', designId: designIdOfVersion(id) },
      () => updateVersionNote(id, note)
    )
  )
}

/** 이 버전이 어느 설계 것인가 — 못 찾으면 빈 문자열(받는 쪽이 무시한다). */
function designIdOfVersion(id: string): string {
  for (const d of listDesigns()) {
    if (listVersions(d.id).some((v) => v.id === id)) return d.id
  }
  return ''
}
