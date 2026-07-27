import type { ServiceMigration } from './types'

/**
 * UI/UX 서비스의 로컬 저장소 스키마 — **아직 비어 있다.**
 *
 * 이 파일은 UI/UX 에이전트의 자리다. 테이블이 필요해지면 여기에만 더한다:
 *   1. `tables` 에 이름을 적고 (서비스끼리 겹치면 적용이 실패한다)
 *   2. `schema` 에 `CREATE TABLE IF NOT EXISTS` 로 선언하고
 *   3. 이름은 `uiux_` 접두어로 (AGENTS.md 네임스페이스 규칙)
 * 다른 서비스 파일이나 `store/db.ts` 는 건드리지 않는다.
 */
export const uiuxMigration: ServiceMigration = {
  service: 'uiux',
  tables: [],
  schema: ''
}
