import type { DatabaseSync } from 'node:sqlite'
import { recoverLostTableSchemas } from './recoverTableSchema'
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
    'migration_logs',
    'query_history',
    'query_folders',
    'saved_queries',
    'collection_folders',
    'collections',
    'collection_items',
    'seed_sets',
    'env_variables',
    'diagram_layouts',
    'db_grant_sets',
    'db_data_filters'
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
      schema_name TEXT NOT NULL DEFAULT '',
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

    -- Connection: 원시 접속(엔드포인트/자격증명), 설계 무관. Remote 를 구동.
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
      schemas            TEXT NOT NULL DEFAULT '[]',
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

    -- 저장 쿼리 라이브러리 (폴더 트리). 소속은 설계 아니면 연결 한쪽이다 —
    -- 둘 중 채워진 칸이 주인이고, 판정은 shared/db/libraryOwner 에 있다.
    CREATE TABLE IF NOT EXISTS query_folders (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL DEFAULT '',
      design_id     TEXT NOT NULL DEFAULT '',
      parent_id     TEXT,
      name          TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_folders_conn ON query_folders(connection_id);

    CREATE TABLE IF NOT EXISTS saved_queries (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL DEFAULT '',
      design_id     TEXT NOT NULL DEFAULT '',
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
      connection_id TEXT NOT NULL DEFAULT '',
      design_id     TEXT NOT NULL DEFAULT '',
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
      connection_id TEXT NOT NULL DEFAULT '',
      design_id     TEXT NOT NULL DEFAULT '',
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

    -- Design › Seed: 시드 세트(설계가 정의하는 기준 데이터). 테이블당 하나 → (design_id, table_name) PK.
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

    -- ERD 레이아웃 — 스코프별 노드 위치/뷰포트/그룹(JSON). 노드 키는 t:<테이블명>.
    -- 스코프 키: Remote = 연결 id, Design = design:<설계 id>.
    CREATE TABLE IF NOT EXISTS diagram_layouts (
      connection_id TEXT PRIMARY KEY,
      positions     TEXT NOT NULL DEFAULT '{}',
      viewport      TEXT,
      groups        TEXT NOT NULL DEFAULT '[]',
      updated_at    TEXT NOT NULL
    );

    -- 저장 필터 — Data 화면에서 이름 붙여 남긴 조건 묶음(§db-remote.data.saved-filter).
    -- 주인이 셋(연결·스키마·표)인 이유: 이름만으로 가르면 범위에 스키마가 둘 이상 켜졌을 때
    -- 같은 이름 표의 필터가 섞인다. 스키마 빈 문자열 = 기본 스키마(§db/schemaRef 와 같은 규칙).
    CREATE TABLE IF NOT EXISTS db_data_filters (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      schema_name   TEXT NOT NULL DEFAULT '',
      table_name    TEXT NOT NULL,
      name          TEXT NOT NULL,
      filters       TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_db_data_filters_table
      ON db_data_filters(connection_id, schema_name, table_name);

    -- 권한 세트(§db-remote.grants.sets) — 연결 참조가 **없다**: 연결을 지워도 세트는 남아
    -- 다른 환경에 재적용된다(재활용이 존재 이유). items 는 (테이블 패턴 × 권한들) JSON.
    CREATE TABLE IF NOT EXISTS db_grant_sets (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      items      TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,

  alter(d: DatabaseSync): void {
    // 구 스키마 호환 보정 — `CREATE TABLE IF NOT EXISTS` 는 기존 테이블에 컬럼을 더하지 못한다.
    // 이미 쓰고 있던 로컬 DB 파일을 깨지 않고 컬럼만 얹기 위한 경로다.

    // designs·connections.project_id — 공용 projects 의 소속. **비워 둘 수 있다(무소속)**.
    // 설계와 접속에만 붙인다: 그 안에 든 테이블·쿼리·환경은 부모를 타고 프로젝트가 정해지므로
    // 칸을 또 두면 "설계는 쿠팡인데 그 안 테이블은 배민" 인 있을 수 없는 상태가 생긴다.
    addColumnIfMissing(d, 'designs', 'project_id', 'TEXT')
    addColumnIfMissing(d, 'connections', 'project_id', 'TEXT')

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

    // tables.schema_name — 소속 스키마(PostgreSQL schema · MySQL database · SQLite main).
    // 기본값이 빈 문자열이라 **예전 행은 전부 "기본 스키마"로 올라온다** — 값을 채워 넣는
    // 데이터 이전 없이 동작이 그대로다(`db/schemaRef` 가 빈 스키마를 같은 스키마로 다룬다).
    // `schema` 는 SQLite 예약어가 아니지만 다른 방언에선 걸려서 `schema_name` 으로 둔다.
    addColumnIfMissing(d, 'tables', 'schema_name', `TEXT NOT NULL DEFAULT ''`)

    // connections.schemas — 그 연결에서 지금 보고 있는 스키마 목록(범위). JSON 배열.
    // 비면 "기본 스키마 하나"다 — 예전 연결은 지금과 똑같이 동작한다.
    addColumnIfMissing(d, 'connections', 'schemas', `TEXT NOT NULL DEFAULT '[]'`)

    // designs.schemas — 그 설계에서 지금 보고 있는 스키마 목록(범위). 운영부의 connections.schemas 와
    // 같은 자리다: 여러 스키마를 한 설계로 가져오면 목록이 뒤섞여, 볼 것을 골라야 한다.
    // 비면 **전부 본다** — 예전 설계는 지금과 똑같이 동작한다(연결 쪽의 "기본 하나"와 다른 이유는
    // 설계엔 읽어 올 비용이 없어서다. 다 보여 주는 것이 손해가 아니다).
    addColumnIfMissing(d, 'designs', 'schemas', `TEXT NOT NULL DEFAULT '[]'`)

    // designs.declared_schemas — 그 설계가 **선언한** 스키마 목록(순서 있음, 첫째가 기본).
    // 위 `schemas`(보는 범위)와 자리가 다르다: 범위는 줄였다 늘렸다 하는 값이고 이쪽은
    // "이 설계에 어떤 스키마가 있다"는 선언이다. 겸용하면 범위를 하나로 좁히는 순간 다른
    // 스키마가 설계에서 사라진다. 선언이 따로 있어야 **표가 없는 빈 스키마**를 만들 수 있고,
    // 그게 없어서 실 DB 를 물리지 않으면 설계를 시작할 수 없었다(2026-08-11 사용자 지적).
    addColumnIfMissing(d, 'designs', 'declared_schemas', `TEXT NOT NULL DEFAULT '[]'`)
    backfillDeclaredSchemas(d)

    // 잃어버린 스키마 되살리기 — 설계부의 저장 매핑이 `schema` 를 흘려(2026-08-03 수정) 여러
    // 스키마로 짜인 설계가 전부 한 스키마로 뭉개진 채 굳었다. id 에는 스키마가 남아 있으므로
    // 앱을 켤 때 되찾아 채운다. **사용자가 뭘 누를 필요가 없어야 한다** — 앱이 낸 손해다.
    // 몇 번을 지나가도 결과가 같아(빈 값만 채운다) 매 실행 지나가도 된다.
    recoverLostTableSchemas(d)

    // 기준선(env_snapshots) 폐기 — 2026-08-12. "마지막으로 확인한 실 DB 모습"을 남겨 두고
    // 지금과 견줘 남이 손댔는지 가리던 표다. 그 판정을 "설계에 없는데 DB 에 있는 것"으로
    // 갈음하면서 쓸 데가 없어졌다. 남겨 두면 쓰는 곳 없는 데이터가 계속 쌓인다.
    d.exec('DROP TABLE IF EXISTS env_snapshots;')

    // 그 시절 이력도 함께 — 2026-08-13. 표만 지우고 `migration_logs` 를 안 건드렸더니
    // 화면이 이제 없는 낱말("기준선")을 배지로 계속 보였다. `baseline` 이 적던 사건은
    // 실은 맵핑("이 연결은 vX 다")이라 종류만 갈아 끼우면 이력이 안 끊긴다. `drift` 는
    // 판정 자체가 사라져 다시 이어 볼 수도, 새로 쌓일 수도 없으므로 지운다.
    d.exec(`UPDATE migration_logs SET kind = 'map' WHERE kind = 'baseline';
            DELETE FROM migration_logs WHERE kind = 'drift';`)

    // diagram_layouts.groups — 다이어그램 그룹(레이어): 이름·색·소속 테이블·접힘.
    // 배치와 같은 행에 둔다 — 스코프(연결/설계)가 같고 언제나 함께 읽고 쓰기 때문.
    addColumnIfMissing(d, 'diagram_layouts', 'groups', `TEXT NOT NULL DEFAULT '[]'`)

    // 라이브러리(저장쿼리·컬렉션)의 **설계 소속** — 왜 여는지는 `@shared/db/libraryOwner` 에 있다.
    // 요약: 쿼리는 접속 정보가 아니라 스키마에 대해 쓴다. 비어 있으면 예전처럼 연결 소속이라
    // **컬럼만 얹은 시점에는 동작이 하나도 안 바뀐다** — 옮기는 일은 아래 이사가 따로 한다.
    for (const t of ['query_folders', 'saved_queries', 'collection_folders', 'collections']) {
      addColumnIfMissing(d, t, 'design_id', `TEXT NOT NULL DEFAULT ''`)
    }
    moveLibraryToBoundDesign(d)
  }
}

/**
 * 연결에 매여 있던 라이브러리를 **그 연결에 물린 설계로 옮긴다**(한 번만, 자동).
 *
 * 이걸 안 하면 새 소속은 앞으로 만드는 것에만 걸려, 정작 사용자가 그동안 쌓아 둔 쿼리는
 * 여전히 연결 하나에 갇힌 채다 — 고쳐 달라던 두 가지가 옛 데이터에선 그대로 남는다.
 *
 * **설계가 딱 하나 물린 연결만** 옮긴다. 둘 이상이면 어느 설계 것인지 앱이 고를 수 없고,
 * 잘못 고르면 남의 설계 화면에 남의 쿼리가 뜬다(`libraryOwner.ownerFor` 와 같은 판정).
 * `design_id` 가 빈 행만 건드리므로 몇 번을 지나가도 결과가 같다.
 */
function moveLibraryToBoundDesign(d: DatabaseSync): void {
  // 설계를 정확히 하나만 물린 연결 → 그 설계.
  const pairs = d
    .prepare(
      `SELECT connection_id, MIN(design_id) AS design_id FROM environments
       GROUP BY connection_id HAVING COUNT(DISTINCT design_id) = 1`
    )
    .all() as unknown as { connection_id: string; design_id: string }[]
  if (pairs.length === 0) return

  for (const t of ['query_folders', 'saved_queries', 'collection_folders', 'collections']) {
    // connection_id 는 비워 둔다 — 소속이 옮겨졌는데 옛 자리가 남아 있으면 "이 연결만의 것"
    // 목록에 같은 행이 한 번 더 잡힌다.
    const stmt = d.prepare(
      `UPDATE ${t} SET design_id = ?, connection_id = '' WHERE design_id = '' AND connection_id = ?`
    )
    for (const p of pairs) stmt.run(p.design_id, p.connection_id)
  }
}

/**
 * `declared_schemas` 채우기 — 예전 설계는 선언이 없으니 **표에 실제로 붙어 있는 이름**에서 딴다.
 *
 * 지어내지 않는다: 표에 이름이 하나도 없으면 빈 채로 둔다. 그러면 화면이 "스키마 이름을
 * 정하세요"라고 물을 수 있는데, 아무 이름이나 넣어 두면 그 물음이 사라지고 틀린 이름이 굳는다.
 * 순서는 이름순 — 예전 데이터에는 사람이 정한 순서라는 것이 없다.
 *
 * 이미 채워진 설계는 건드리지 않아 몇 번을 지나가도 결과가 같다.
 */
function backfillDeclaredSchemas(d: DatabaseSync): void {
  const targets = d
    .prepare(`SELECT id FROM designs WHERE declared_schemas IS NULL OR declared_schemas IN ('', '[]')`)
    .all() as unknown as { id: string }[]
  if (targets.length === 0) return

  const pick = d.prepare(
    `SELECT DISTINCT schema_name FROM tables
     WHERE design_id = ? AND schema_name <> '' ORDER BY schema_name`
  )
  const save = d.prepare('UPDATE designs SET declared_schemas = ? WHERE id = ?')
  for (const t of targets) {
    const names = (pick.all(t.id) as unknown as { schema_name: string }[]).map((r) => r.schema_name)
    if (names.length > 0) save.run(JSON.stringify(names), t.id)
  }
}
