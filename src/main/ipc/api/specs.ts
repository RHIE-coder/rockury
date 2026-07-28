import { ipcMain } from 'electron'
import {
  createSpec,
  createVersion,
  deleteSpec,
  getSpec,
  listSpecs,
  listVersions,
  replaceRequests,
  updateSpec,
  type CreateSpecInput
} from '../../store/apiSpecs'
import { applyPatch, type PatchOp } from '../../../shared/api/patch'
import type { RequestDef } from '../../../shared/api/types'

/**
 * API 명세 IPC — 렌더러가 `window.rockury.apiSpecs.*` 로 호출한다.
 *
 * 규칙(이름 유일·모양 정합·안 쓰는 칸 거부)은 여기가 아니라 **스토어**가 강제한다.
 * 여기에 두면 MCP 경로가 그대로 우회한다.
 */
export function registerApiSpecIpc(): void {
  ipcMain.handle('api:listSpecs', () => listSpecs())
  ipcMain.handle('api:getSpec', (_e, id: string) => getSpec(id) ?? null)
  ipcMain.handle('api:createSpec', (_e, input: CreateSpecInput) => createSpec(input))
  ipcMain.handle('api:updateSpec', (_e, id: string, patch: { name: string; description: string }) =>
    updateSpec(id, patch)
  )
  ipcMain.handle('api:setSpec', (_e, specId: string, requests: RequestDef[]) =>
    replaceRequests(specId, requests)
  )
  ipcMain.handle('api:patchSpec', (_e, specId: string, ops: PatchOp[]) => {
    const spec = getSpec(specId)
    if (!spec) throw new Error(`명세 "${specId}" 가 없습니다.`)
    const { spec: next, changes } = applyPatch(spec, ops)
    replaceRequests(specId, next.requests)
    return changes
  })
  ipcMain.handle('api:deleteSpec', (_e, id: string) => deleteSpec(id))

  ipcMain.handle('api:listVersions', (_e, specId: string) => listVersions(specId))
  ipcMain.handle('api:createVersion', (_e, specId: string, number: string, note?: string) =>
    createVersion(specId, number, note ?? '')
  )
}
