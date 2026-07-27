import type { DatabaseSync } from 'node:sqlite'

/**
 * 서비스 식별자 — `src/renderer/src/nav/registry.ts` 의 `Service.id` 와 **같은 토큰**을 쓴다.
 * 토큰을 둘로 늘리면 병렬 개발에서 "내 파일이 어느 쪽이냐"가 흐려진다 — 서비스당 이름 하나.
 * (AI 서비스는 `ai` 다. MCP 는 그 안의 기능 하나일 뿐이라 서비스 이름이 될 수 없다.)
 */
export const SERVICE_IDS = ['uiux', 'api', 'db', 'infra', 'ai'] as const
export type ServiceId = (typeof SERVICE_IDS)[number]

/**
 * 한 서비스가 로컬 저장소(SQLite)에 요구하는 스키마.
 *
 * 병렬 개발의 전제: **서비스마다 파일 하나.** 새 테이블이 필요하면 자기 서비스 파일만 고치면
 * 되고, 다른 서비스 에이전트와 같은 줄을 건드릴 일이 없다.
 */
export interface ServiceMigration {
  /** `SERVICE_IDS` 중 하나. 그 외 값은 적용 시점에 실패한다. */
  service: string
  /**
   * 이 서비스가 소유한 테이블 이름 전수.
   * 서비스끼리 겹치면 적용이 실패한다 — `CREATE TABLE IF NOT EXISTS` 탓에 뒤에 온 쪽이
   * 조용히 무시되고, 그 서비스는 자기가 원한 모양이 아닌 테이블을 쓰게 되기 때문이다.
   */
  tables: string[]
  /** CREATE TABLE/INDEX 문. 앱을 켤 때마다 다시 도므로 재실행 안전(`IF NOT EXISTS`)이어야 한다. */
  schema: string
  /** `schema` 보다 먼저 도는 정리 — 폐기된 테이블 드롭, 구 스키마 재작성 등. */
  before?: (d: DatabaseSync) => void
  /** `schema` 뒤에 도는 구 스키마 보정 — `CREATE IF NOT EXISTS` 로는 못 더하는 컬럼 ALTER 등. */
  alter?: (d: DatabaseSync) => void
}

/** 컬럼이 없을 때만 ALTER — 구 스키마 호환 보정의 공통 도구. */
export function addColumnIfMissing(
  d: DatabaseSync,
  table: string,
  column: string,
  decl: string
): void {
  // table·column 은 호출부의 하드코딩 리터럴이라 인터폴레이션 안전(사용자 입력 경로 없음).
  const has = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name='${column}'`)
    .get() as unknown as { c: number }
  if (has.c === 0) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}
