import type { DatabaseSync } from 'node:sqlite'
import type { ServiceMigration } from './types'

/**
 * AI 서비스(코드 id `mcp`)의 로컬 저장소 스키마.
 *
 * 지금은 소유 테이블이 없다 — 접속 키는 OS 키체인에, 게이트웨이 상태는 메모리에 산다.
 * AI 서비스에 영속 데이터가 필요해지면 **이 파일에만** 테이블을 더하면 된다.
 */
export const mcpMigration: ServiceMigration = {
  service: 'mcp',
  tables: [],

  before(d: DatabaseSync): void {
    // 폐기된 테이블 정리 — 프로젝트별 `.mcp.json` 셋업 방식을 제거(2026-07-24)하면서
    // mcp_projects 가 쓸모없어졌다. 이미 이 테이블을 가진 로컬 DB 에서 지운다.
    d.exec('DROP TABLE IF EXISTS mcp_projects;')
  },

  schema: ''
}
