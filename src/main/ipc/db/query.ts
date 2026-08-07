import { ipcMain } from 'electron'
import { queryService } from '../../services/queryService'
import { appendHistory, clearHistory, listHistory, type AppendHistoryInput } from '../../store/queryHistory'
import { envelope } from '../envelope'
import { writing } from '../peers'

/**
 * 쿼리 실행 IPC(§ops-plan Phase 2c) — 봉투 패턴.
 * run(즉시 실행) + 트랜잭션 게이트(txBegin/txExec/txCommit/txRollback).
 */
export function registerQueryIpc(): void {
  ipcMain.handle('query:run', (_e, envId: string, sql: string) =>
    envelope(() => queryService.run(envId, sql))
  )
  ipcMain.handle('query:runParams', (_e, envId: string, sql: string, params: unknown[]) =>
    envelope(() => queryService.runParams(envId, sql, params))
  )
  ipcMain.handle('query:txBegin', (_e, envId: string) => envelope(() => queryService.txBegin(envId)))
  ipcMain.handle('query:txExec', (_e, txId: string, sql: string) =>
    envelope(() => queryService.txExec(txId, sql))
  )
  ipcMain.handle('query:txExecParams', (_e, txId: string, sql: string, params: unknown[]) =>
    envelope(() => queryService.txExecParams(txId, sql, params))
  )
  ipcMain.handle('query:txCommit', (_e, txId: string) => envelope(() => queryService.txCommit(txId)))
  ipcMain.handle('query:txRollback', (_e, txId: string) =>
    envelope(() => queryService.txRollback(txId))
  )
  ipcMain.handle('query:explain', (_e, connectionId: string, sql: string) =>
    envelope(() => queryService.explain(connectionId, sql))
  )
  ipcMain.handle('query:historyAppend', (e, input: AppendHistoryInput) =>
    writing(e, { domain: 'queryHistory' }, () => appendHistory(input))
  )
  ipcMain.handle('query:historyList', (_e, connectionId: string) =>
    envelope(() => listHistory(connectionId))
  )
  ipcMain.handle('query:historyClear', (e, connectionId: string) =>
    writing(e, { domain: 'queryHistory' }, () => clearHistory(connectionId))
  )
}
