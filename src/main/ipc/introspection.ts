import { ipcMain } from 'electron'
import { introspectionService } from '../services/introspectionService'
import { envelope } from './envelope'

/**
 * Introspection IPC(§ops-plan Phase 2a) — 봉투 패턴. 활성 환경의 실 DB 스키마를
 * 벤더 중립 IR 로 돌려준다(렌더러가 TableDef 로 정규화).
 */
export function registerIntrospectionIpc(): void {
  ipcMain.handle('introspection:run', (_e, envId: string) =>
    envelope(() => introspectionService.run(envId))
  )
}
