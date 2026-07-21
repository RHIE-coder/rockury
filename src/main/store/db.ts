import { app } from 'electron'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { SEED_TABLES, SEED_VERSIONS } from './seed'

/**
 * Rockury 로컬 메타 저장소 (설계·버전·스냅샷·이력의 지상 진실 — IA §4).
 *
 * Electron 43 이 번들한 Node 24 의 내장 `node:sqlite` 를 사용한다 —
 * 네이티브 모듈(better-sqlite3)·electron-rebuild 없이 진짜 SQL 저장소를 얻는다.
 * 파일은 OS 사용자 데이터 디렉터리(app userData)에 둔다.
 */
let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const file = join(app.getPath('userData'), 'rockury.db')
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  seed(db)
  return db
}

/** 스키마 마이그레이션 — designs + tables(문서형). 이후 versions/snapshots/logs 확장 예정. */
function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dialect     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tables (
      id          TEXT PRIMARY KEY,
      design_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      comment     TEXT NOT NULL DEFAULT '',
      position    INTEGER NOT NULL DEFAULT 0,
      columns     TEXT NOT NULL DEFAULT '[]',
      constraints TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_tables_design ON tables(design_id);

    CREATE TABLE IF NOT EXISTS versions (
      id         TEXT PRIMARY KEY,
      design_id  TEXT NOT NULL,
      number     TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      snapshot   TEXT NOT NULL,
      locked     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_versions_design ON versions(design_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_versions_design_number ON versions(design_id, number);

    CREATE TABLE IF NOT EXISTS environments (
      id                 TEXT PRIMARY KEY,
      design_id          TEXT NOT NULL,
      name               TEXT NOT NULL,
      db_type            TEXT NOT NULL,
      host               TEXT NOT NULL DEFAULT '',
      port               INTEGER NOT NULL DEFAULT 0,
      database_name      TEXT NOT NULL DEFAULT '',
      db_user            TEXT NOT NULL DEFAULT '',
      encrypted_password TEXT NOT NULL DEFAULT '',
      ssl_enabled        INTEGER NOT NULL DEFAULT 0,
      ssl_config         TEXT,
      target_version     TEXT NOT NULL DEFAULT '',
      applied_version    TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_environments_design ON environments(design_id);

    CREATE TABLE IF NOT EXISTS env_snapshots (
      id         TEXT PRIMARY KEY,
      env_id     TEXT NOT NULL,
      version    TEXT NOT NULL DEFAULT '',
      snapshot   TEXT NOT NULL,
      checksum   TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_env_snapshots_env ON env_snapshots(env_id);

    CREATE TABLE IF NOT EXISTS migration_logs (
      id           TEXT PRIMARY KEY,
      env_id       TEXT NOT NULL,
      kind         TEXT NOT NULL,
      from_version TEXT NOT NULL DEFAULT '',
      to_version   TEXT NOT NULL DEFAULT '',
      summary      TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'success',
      detail       TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_migration_logs_env ON migration_logs(env_id);
  `)
}

/** 첫 실행 시드 — commerce-core (MySQL) 설계 + 예제 테이블. designs 가 비어 있을 때만. */
function seed(d: DatabaseSync): void {
  const { c } = d.prepare('SELECT COUNT(*) AS c FROM designs').get() as unknown as { c: number }
  if (c > 0) return
  d.prepare(
    'INSERT INTO designs (id, name, description, dialect, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('commerce-core', 'commerce-core', '커머스 코어 도메인', 'mysql', new Date().toISOString())

  const insert = d.prepare(
    'INSERT INTO tables (id, design_id, name, comment, position, columns, constraints) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  SEED_TABLES.forEach((t, i) =>
    insert.run(
      t.id,
      t.designId,
      t.name,
      t.comment,
      i,
      JSON.stringify(t.columns),
      JSON.stringify(t.constraints)
    )
  )

  // 버전 이력 시드 — Studio 의 v0.3.14 드리프트 배지와 아귀를 맞춘다.
  const insertVersion = d.prepare(
    'INSERT INTO versions (id, design_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  )
  for (const v of SEED_VERSIONS) {
    insertVersion.run(
      `commerce-core@${v.number}`,
      'commerce-core',
      v.number,
      v.note,
      JSON.stringify(v.snapshot),
      v.createdAt
    )
  }
}
