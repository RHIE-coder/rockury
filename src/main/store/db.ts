import { DatabaseSync } from 'node:sqlite'
import { SEED_TABLES, SEED_VERSIONS } from './seed'

/**
 * DB 파일 경로 주입 seam — db.ts 는 electron 을 import 하지 않는다(테스트 가능성).
 * main 진입점(app.whenReady)에서 `setDbPath(userData/rockury.db)` 를 호출하고,
 * 테스트는 임시 파일 경로를 주입한다(`ROCKURY_DB_PATH` 또는 setDbPath). 실 앱 DB 무관.
 */
let dbPath: string | null = process.env.ROCKURY_DB_PATH ?? null
export function setDbPath(p: string): void {
  dbPath = p
}
function resolveDbFile(): string {
  if (!dbPath) throw new Error('DB 경로 미설정 — main 진입점에서 setDbPath() 를 먼저 호출하세요.')
  return dbPath
}

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
  db = new DatabaseSync(resolveDbFile())
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  seed(db)
  return db
}

/** 스키마 마이그레이션 — designs + tables(문서형). 이후 versions/snapshots/logs 확장 예정. */
function migrate(d: DatabaseSync): void {
  // 레거시 정리(dev): environments 가 구(舊) 엔드포인트 스키마면 Connection 분리 전 형태 →
  // 바인딩 스키마로 재작성하기 위해 관련 ops 테이블을 드롭한다(운영부는 신규라 데이터 손실 무해).
  const hasEnv = d
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='environments'`)
    .get() as unknown as { c: number }
  if (hasEnv.c > 0) {
    const legacy = d
      .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('environments') WHERE name='db_type'`)
      .get() as unknown as { c: number }
    if (legacy.c > 0) {
      d.exec('DROP TABLE IF EXISTS migration_logs; DROP TABLE IF EXISTS env_snapshots; DROP TABLE IF EXISTS environments;')
    }
  }

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
      constraints TEXT NOT NULL DEFAULT '[]',
      is_view     INTEGER NOT NULL DEFAULT 0
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

    -- Connection 그룹: 접속 카드 분류(1단계, 중첩 없음). 삭제 시 소속 연결은 미분류로.
    CREATE TABLE IF NOT EXISTS connection_groups (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Connection: 원시 접속(엔드포인트/자격증명), 설계 무관. Console 을 구동.
    CREATE TABLE IF NOT EXISTS connections (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      db_type            TEXT NOT NULL,
      host               TEXT NOT NULL DEFAULT '',
      port               INTEGER NOT NULL DEFAULT 0,
      database_name      TEXT NOT NULL DEFAULT '',
      db_user            TEXT NOT NULL DEFAULT '',
      encrypted_password TEXT NOT NULL DEFAULT '',
      ssl_enabled        INTEGER NOT NULL DEFAULT 0,
      ssl_config         TEXT,
      auto_check_disabled INTEGER NOT NULL DEFAULT 0,
      group_id           TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    -- Environment: (connection × design) 바인딩 + 타깃/적용 버전. Migration 전용 상태.
    CREATE TABLE IF NOT EXISTS environments (
      id              TEXT PRIMARY KEY,
      connection_id   TEXT NOT NULL,
      design_id       TEXT NOT NULL,
      target_version  TEXT NOT NULL DEFAULT '',
      applied_version TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_env_conn_design ON environments(connection_id, design_id);
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

    CREATE TABLE IF NOT EXISTS query_history (
      id              TEXT PRIMARY KEY,
      connection_id   TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'query',
      sql_text        TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'success',
      row_count       INTEGER NOT NULL DEFAULT 0,
      affected_rows   INTEGER,
      exec_ms         INTEGER,
      error           TEXT NOT NULL DEFAULT '',
      -- 컬렉션 실행 그룹핑: 어느 컬렉션(id/이름) · 실행 배치(run_id) · 그 안 몇 번째(seq).
      collection_id   TEXT,
      collection_name TEXT,
      run_id          TEXT,
      seq             INTEGER,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_history_conn ON query_history(connection_id);

    -- 저장 쿼리 라이브러리 (연결 스코프, 폴더 트리)
    CREATE TABLE IF NOT EXISTS query_folders (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      parent_id     TEXT,
      name          TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_folders_conn ON query_folders(connection_id);

    CREATE TABLE IF NOT EXISTS saved_queries (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      folder_id     TEXT,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      sql_text      TEXT NOT NULL DEFAULT '',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_queries_conn ON saved_queries(connection_id);

    -- 컬렉션 폴더 (컬렉션도 폴더 트리로 관리 — 저장쿼리 트리와 동형)
    CREATE TABLE IF NOT EXISTS collection_folders (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      parent_id     TEXT,
      name          TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collection_folders_conn ON collection_folders(connection_id);

    -- 컬렉션 (순서 있는 쿼리 묶음 — Run-All)
    CREATE TABLE IF NOT EXISTS collections (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      folder_id     TEXT,
      name          TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collections_conn ON collections(connection_id);

    CREATE TABLE IF NOT EXISTS collection_items (
      id             TEXT PRIMARY KEY,
      collection_id  TEXT NOT NULL,
      saved_query_id TEXT,
      name           TEXT NOT NULL DEFAULT '',
      sql_text       TEXT NOT NULL DEFAULT '',
      sort_order     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_collection_items_coll ON collection_items(collection_id);

    -- Studio › Seed: 시드 세트(설계가 정의하는 기준 데이터). 테이블당 하나 → (design_id, table_name) PK.
    -- 컬럼을 이름으로 가리킨다(실 DB 에선 이름이 정체성) → 스키마 컬럼 id 와 조인하지 않는다.
    CREATE TABLE IF NOT EXISTS seed_sets (
      design_id       TEXT NOT NULL,
      table_name      TEXT NOT NULL,
      position        INTEGER NOT NULL DEFAULT 0,
      natural_key     TEXT NOT NULL DEFAULT '[]',
      ignored_columns TEXT NOT NULL DEFAULT '[]',
      strength        TEXT NOT NULL DEFAULT 'ensure',
      -- rows_json: ROWS 는 SQL 키워드(윈도우 프레임)라 컬럼명 충돌을 피해 이름을 바꿨다.
      rows_json       TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (design_id, table_name)
    );
    CREATE INDEX IF NOT EXISTS idx_seed_sets_design ON seed_sets(design_id);

    -- Console 실 ERD(2e) 레이아웃 — 연결별 노드 위치/뷰포트(JSON). 노드 키는 t:<테이블명>.
    CREATE TABLE IF NOT EXISTS diagram_layouts (
      connection_id TEXT PRIMARY KEY,
      positions     TEXT NOT NULL DEFAULT '{}',
      viewport      TEXT,
      updated_at    TEXT NOT NULL
    );

    -- (정리) mcp_projects: 프로젝트별 .mcp.json 셋업 방식 제거(2026-07-24)로 폐기된 테이블.
    DROP TABLE IF EXISTS mcp_projects;
  `)

  // 추가 마이그레이션(구 스키마 호환): collection_items 가 저장쿼리를 "참조"할 수 있도록 컬럼 추가.
  // CREATE IF NOT EXISTS 는 기존 테이블에 컬럼을 더하지 못하므로 pragma 로 확인 후 ALTER.
  const hasRef = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('collection_items') WHERE name='saved_query_id'`)
    .get() as unknown as { c: number }
  if (hasRef.c === 0) d.exec('ALTER TABLE collection_items ADD COLUMN saved_query_id TEXT')

  // query_history.source — 다중 소스(query/data/collection) 구분. 구 스키마 호환 ALTER.
  const hasSource = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('query_history') WHERE name='source'`)
    .get() as unknown as { c: number }
  if (hasSource.c === 0) d.exec(`ALTER TABLE query_history ADD COLUMN source TEXT NOT NULL DEFAULT 'query'`)

  // query_history 컬렉션 그룹핑 컬럼(어느 컬렉션·몇 번째·어느 실행배치). 구 스키마 호환 ALTER.
  // name 은 하드코딩 리터럴이라 인터폴레이션 안전.
  const addHistCol = (name: string, decl: string): void => {
    const has = d
      .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('query_history') WHERE name='${name}'`)
      .get() as unknown as { c: number }
    if (has.c === 0) d.exec(`ALTER TABLE query_history ADD COLUMN ${name} ${decl}`)
  }
  addHistCol('collection_id', 'TEXT')
  addHistCol('collection_name', 'TEXT')
  addHistCol('run_id', 'TEXT')
  addHistCol('seq', 'INTEGER')

  // saved_queries.description — 저장쿼리 설명(Query 뷰 편집기). 구 스키마 호환 ALTER.
  const hasDesc = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('saved_queries') WHERE name='description'`)
    .get() as unknown as { c: number }
  if (hasDesc.c === 0) d.exec(`ALTER TABLE saved_queries ADD COLUMN description TEXT NOT NULL DEFAULT ''`)

  // collections.folder_id — 컬렉션 폴더 트리. 구 스키마 호환 ALTER.
  const hasColFolder = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('collections') WHERE name='folder_id'`)
    .get() as unknown as { c: number }
  if (hasColFolder.c === 0) d.exec('ALTER TABLE collections ADD COLUMN folder_id TEXT')

  // collections.description — 컬렉션 설명(상세화면 편집, Query 와 동일). 구 스키마 호환 ALTER.
  const hasColDesc = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('collections') WHERE name='description'`)
    .get() as unknown as { c: number }
  if (hasColDesc.c === 0) d.exec(`ALTER TABLE collections ADD COLUMN description TEXT NOT NULL DEFAULT ''`)

  // connections.auto_check_disabled — 연결 페이지 진입 시 전체 자동 확인에서 제외할지. 구 스키마 호환 ALTER.
  const hasAutoCheck = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('connections') WHERE name='auto_check_disabled'`)
    .get() as unknown as { c: number }
  if (hasAutoCheck.c === 0) d.exec('ALTER TABLE connections ADD COLUMN auto_check_disabled INTEGER NOT NULL DEFAULT 0')

  // connections.group_id — 접속 카드 그룹 분류. 구 스키마 호환 ALTER.
  const hasGroup = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('connections') WHERE name='group_id'`)
    .get() as unknown as { c: number }
  if (hasGroup.c === 0) d.exec('ALTER TABLE connections ADD COLUMN group_id TEXT')

  // tables.is_view — 역설계로 가져온 뷰(view)인지. 설계부 목록이 테이블과 뷰를 갈라 보여주려면
  // 이 표식이 저장까지 살아남아야 한다(예전엔 IPC 경계에서 유실됐다). 구 스키마 호환 ALTER.
  const hasIsView = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('tables') WHERE name='is_view'`)
    .get() as unknown as { c: number }
  if (hasIsView.c === 0) d.exec('ALTER TABLE tables ADD COLUMN is_view INTEGER NOT NULL DEFAULT 0')
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
