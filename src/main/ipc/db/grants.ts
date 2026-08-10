import { ipcMain } from 'electron'
import { grantsService } from '../../services/grantsService'
import type { GrantChange } from '../../services/grants/statements'
import { createGrantSet, deleteGrantSet, listGrantSets, updateGrantSet, type GrantSetItem } from '../../store/grantSets'
import { envelope } from '../envelope'

/**
 * 권한(Grant) IPC(§db-remote.grants) — 봉투 패턴.
 * 현황(run)·미리보기(plan)·실행(apply)과 권한 세트 CRUD.
 * plan 과 apply 는 같은 문장 생성기를 태운다(미리보기=실행, apply AC-4).
 */
export function registerGrantsIpc(): void {
  ipcMain.handle('grants:run', (_e, connId: string) => envelope(() => grantsService.run(connId)))
  ipcMain.handle(
    'grants:plan',
    (_e, connId: string, changes: GrantChange[], opts: { includeRevoke: boolean; currentAccount: string }) =>
      envelope(() => grantsService.plan(connId, changes, opts))
  )
  ipcMain.handle(
    'grants:apply',
    (_e, connId: string, changes: GrantChange[], opts: { includeRevoke: boolean }) =>
      envelope(() => grantsService.apply(connId, changes, opts))
  )

  ipcMain.handle('grantSets:list', () => envelope(() => listGrantSets()))
  ipcMain.handle('grantSets:create', (_e, name: string, items: GrantSetItem[]) =>
    envelope(() => createGrantSet(name, items))
  )
  ipcMain.handle('grantSets:update', (_e, id: string, patch: { name?: string; items?: GrantSetItem[] }) =>
    envelope(() => updateGrantSet(id, patch))
  )
  ipcMain.handle('grantSets:delete', (_e, id: string) => envelope(() => deleteGrantSet(id)))
}
