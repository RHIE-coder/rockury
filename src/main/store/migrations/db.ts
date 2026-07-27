import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, type ServiceMigration } from './types'

/**
 * DB 서비스의 로컬 저장소 스키마 (설계·버전·스냅샷·이력의 지상 진실 — IA §4).
 *
 * 분할 전에는 `store/db.ts` 의 `migrate()` 한 함수가 전부를 들고 있었다. 서비스별로 갈라
 * 놓은 이유는 병렬 개발 — 다른 서비스가 테이블을 더할 때 이 파일을 건드리지 않게 하기 위해서다.
 */
export const dbMigration: ServiceMigration = {
  service: 'db',
  tables: [
    'designs',
    'tables',
    'versions',
    'connection_groups',
    'connections',
    'environments',
    'env_snapshots',
    'migration_logs',
    'query_history',
    'query_folders',
    'saved_queries',
    'collection_folders',
    'collections',
    'collection_items',
    'seed_sets',
    'env_variables',
    'diagram_layouts'
  ],

  before(d: DatabaseSync): void {
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
        d.exec(
          'DROP TABLE IF EXISTS migration_logs; DROP TABLE IF EXISTS env_snapshots; DROP TABLE IF EXISTS environments;'
        )
      }
    }
  },

  schema: `
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
      is_view     INTEGER NOT NULL DEFAULT 0,
      view_sql    TEXT NOT NULL DEFAULT ''
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

    -- 환경 변수 값 — 시드의 {{NAME}} 을 반영할 때 채우는 값. 값은 OS 키체인으로 암호화해 넣는다
    -- (비밀값이 평문으로 남지 않게). 스코프는 환경(connection×design 바인딩).
    CREATE TABLE IF NOT EXISTS env_variables (
      env_id          TEXT NOT NULL,
      name            TEXT NOT NULL,
      encrypted_value TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (env_id, name)
    );

    -- Console 실 ERD(2e) 레이아웃 — 연결별 노드 위치/뷰포트(JSON). 노드 키는 t:<테이블명>.
    CREATE TABLE IF NOT EXISTS diagram_layouts (
      connection_id TEXT PRIMARY KEY,
      positions     TEXT NOT NULL DEFAULT '{}',
      viewport      TEXT,
      updated_at    TEXT NOT NULL
    );
  `,

  alter(d: DatabaseSync): void {
    // 구 스키마 호환 보정 — `CREATE TABLE IF NOT EXISTS` 는 기존 테이블에 컬럼을 더하지 못한다.
    // 이미 쓰고 있던 로컬 DB 파일을 깨지 않고 컬럼만 얹기 위한 경로다.

    // collection_items.saved_query_id — 컬렉션 아이템이 저장쿼리를 "참조"할 수 있도록.
    addColumnIfMissing(d, 'collection_items', 'saved_query_id', 'TEXT')

    // query_history.source — 다중 소스(query/data/collection) 구분.
    addColumnIfMissing(d, 'query_history', 'source', `TEXT NOT NULL DEFAULT 'query'`)

    // query_history 컬렉션 그룹핑 — 어느 컬렉션·몇 번째·어느 실행배치.
    addColumnIfMissing(d, 'query_history', 'collection_id', 'TEXT')
    addColumnIfMissing(d, 'query_history', 'collection_name', 'TEXT')
    addColumnIfMissing(d, 'query_history', 'run_id', 'TEXT')
    addColumnIfMissing(d, 'query_history', 'seq', 'INTEGER')

    // saved_queries.description — 저장쿼리 설명(Query 뷰 편집기).
    addColumnIfMissing(d, 'saved_queries', 'description', `TEXT NOT NULL DEFAULT ''`)

    // collections.folder_id / description — 컬렉션 폴더 트리 + 상세화면 설명 편집.
    addColumnIfMissing(d, 'collections', 'folder_id', 'TEXT')
    addColumnIfMissing(d, 'collections', 'description', `TEXT NOT NULL DEFAULT ''`)

    // connections.auto_check_disabled — 연결 페이지 진입 시 전체 자동 확인에서 제외할지.
    addColumnIfMissing(d, 'connections', 'auto_check_disabled', 'INTEGER NOT NULL DEFAULT 0')

    // connections.group_id — 접속 카드 그룹 분류.
    addColumnIfMissing(d, 'connections', 'group_id', 'TEXT')

    // tables.is_view — 역설계로 가져온 뷰(view)인지. 설계부 목록이 테이블과 뷰를 갈라 보여주려면
    // 이 표식이 저장까지 살아남아야 한다(예전엔 IPC 경계에서 유실됐다).
    addColumnIfMissing(d, 'tables', 'is_view', 'INTEGER NOT NULL DEFAULT 0')

    // tables.view_sql — 설계부에서 선언한 뷰의 본문 SELECT(`CREATE VIEW … AS` 뒷부분).
    // is_view 만으로는 뷰를 실 DB 에 만들 수 없다 — 본문이 있어야 DDL 이 성립한다.
    addColumnIfMissing(d, 'tables', 'view_sql', `TEXT NOT NULL DEFAULT ''`)
  }
}
