import { ipcMain, type IpcMainInvokeEvent } from 'electron'
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
import type { ApiChangedEvent } from '../../ai/apiTools'
import { notifyPeersOn } from '../peers'

/**
 * API 명세 IPC — 렌더러가 `window.rockury.apiSpecs.*` 로 호출한다.
 *
 * 규칙(이름 유일·모양 정합·안 쓰는 칸 거부)은 여기가 아니라 **스토어**가 강제한다.
 * 여기에 두면 MCP 경로가 그대로 우회한다.
 *
 * 쓰기는 성공하면 **다른 창들**에 `api:changed` 를 보낸다(에이전트 쓰기가 쓰던 통로 그대로).
 * 안 보내면 창마다 시작할 때 읽은 목록이 영영 안 맞는다 — `ipc/peers.ts` 머리말.
 */
export function registerApiSpecIpc(): void {
  /** 쓰기 하나 — 성공하면 그 명세를 가리켜 다른 창에 알린다. */
  const write = async <T>(
    event: IpcMainInvokeEvent,
    at: ApiChangedEvent | ((data: T) => ApiChangedEvent),
    run: () => T | Promise<T>
  ): Promise<T> => {
    const data = await run()
    notifyPeersOn('api:changed', event.sender, typeof at === 'function' ? at(data) : at)
    return data
  }

  ipcMain.handle('api:listSpecs', () => listSpecs())
  ipcMain.handle('api:getSpec', (_e, id: string) => getSpec(id) ?? null)
  ipcMain.handle('api:createSpec', (e, input: CreateSpecInput) =>
    write(e, (spec) => ({ domain: 'specs', specId: spec.id }), () => createSpec(input))
  )
  ipcMain.handle(
    'api:updateSpec',
    (
      e,
      id: string,
      patch: { name: string; description: string; docs?: string; projectId?: string | null }
    ) => write(e, { domain: 'specs', specId: id }, () => updateSpec(id, patch))
  )
  ipcMain.handle('api:setSpec', (e, specId: string, requests: RequestDef[]) =>
    write(e, { domain: 'requests', specId }, () => replaceRequests(specId, requests))
  )
  ipcMain.handle('api:patchSpec', (e, specId: string, ops: PatchOp[]) =>
    write(e, { domain: 'requests', specId }, () => {
      const spec = getSpec(specId)
      if (!spec) throw new Error(`명세 "${specId}" 가 없습니다.`)
      const { spec: next, changes } = applyPatch(spec, ops)
      replaceRequests(specId, next.requests)
      return changes
    })
  )
  ipcMain.handle('api:deleteSpec', (e, id: string) =>
    write(e, { domain: 'specs', specId: id }, () => deleteSpec(id))
  )

  ipcMain.handle('api:listVersions', (_e, specId: string) => listVersions(specId))
  ipcMain.handle('api:createVersion', (e, specId: string, number: string, note?: string) =>
    write(e, { domain: 'versions', specId }, () => createVersion(specId, number, note ?? ''))
  )
}
