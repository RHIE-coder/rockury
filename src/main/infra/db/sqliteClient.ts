import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite 타깃 드라이버 — rky-mvp 는 better-sqlite3 를 썼지만 이 리포는
 * 네이티브 모듈 금지(§CLAUDE.md) 라 **내장 `node:sqlite` 로 어댑트**한다.
 * 조회 전용이므로 항상 readOnly 로 연다(운영부 Remote/Introspection 의 토대).
 */
export interface SqliteConnectionConfig {
  /** DB 파일 경로. */
  database: string
}

export function createSqliteConnection(config: SqliteConnectionConfig): DatabaseSync {
  return new DatabaseSync(config.database, { readOnly: true })
}

export function closeSqliteConnection(db: DatabaseSync): void {
  db.close()
}
