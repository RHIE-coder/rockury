import { ipcMain } from 'electron'
import { introspectionService } from '../../services/introspectionService'
import { envelope } from '../envelope'

/**
 * Introspection IPC(§ops-plan Phase 2a · §db-remote.scope) — 봉투 패턴.
 * 활성 연결의 실 DB 스키마를 벤더 중립 IR 로 돌려준다(렌더러가 TableDef 로 정규화).
 *
 * `run` 의 두 번째 인자는 범위(어느 스키마를 읽나) — 안 주면 연결에 저장된 범위를 쓴다.
 * `schemas`/`catalogs` 는 범위 선택기가 고를 목록을 채우는 조회다.
 */
export function registerIntrospectionIpc(): void {
  ipcMain.handle('introspection:run', (_e, connId: string, schemas?: string[]) =>
    envelope(() => introspectionService.run(connId, schemas))
  )
  ipcMain.handle('introspection:schemas', (_e, connId: string) =>
    envelope(() => introspectionService.schemas(connId))
  )
  ipcMain.handle('introspection:catalogs', (_e, connId: string) =>
    envelope(() => introspectionService.catalogs(connId))
  )
}
