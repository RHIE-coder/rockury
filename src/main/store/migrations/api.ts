import type { ServiceMigration } from './types'

/**
 * API 서비스의 로컬 저장소 스키마 — `docs/spec/api-service.md` §2 도메인 모델.
 *
 * 이름은 전부 `api_` 접두어다(AGENTS.md 네임스페이스 규칙 — 두 서비스가 같은 테이블을
 * 선언하면 앱이 안 켜진다). 다른 서비스 파일이나 `store/db.ts` 는 건드리지 않는다.
 *
 * 요청·파라미터·응답을 각각 테이블로 쪼개지 않고 JSON 열로 둔 이유: 이것들은 **명세 하나가
 * 통째로 오가는** 단위다(MCP `api_get_spec` 이 한 덩어리로 주고, 버전은 그 스냅샷이다).
 * 쪼개면 매 읽기마다 조인이 붙는데 얻는 게 없다 — DB 서비스가 `tables.columns` 를 JSON 으로
 * 둔 것과 같은 판단이다.
 */
export const apiMigration: ServiceMigration = {
  service: 'api',
  tables: [
    'api_specs',
    'api_requests',
    'api_versions',
    'api_environments',
    'api_runs',
    'api_contract_logs'
  ],

  schema: `
    CREATE TABLE IF NOT EXISTS api_specs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_requests (
      id          TEXT PRIMARY KEY,
      spec_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      folder      TEXT NOT NULL DEFAULT '',
      shape       TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      params      TEXT NOT NULL DEFAULT '[]',
      request     TEXT NOT NULL DEFAULT '{}',
      responses   TEXT NOT NULL DEFAULT '[]',
      docs        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_api_requests_spec ON api_requests (spec_id, position);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_requests_name ON api_requests (spec_id, name);

    CREATE TABLE IF NOT EXISTS api_versions (
      id          TEXT PRIMARY KEY,
      spec_id     TEXT NOT NULL,
      number      TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      snapshot    TEXT NOT NULL,
      locked      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_versions_number ON api_versions (spec_id, number);

    CREATE TABLE IF NOT EXISTS api_environments (
      id          TEXT PRIMARY KEY,
      spec_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      base_url    TEXT NOT NULL DEFAULT '',
      production  INTEGER NOT NULL DEFAULT 0,
      values_json TEXT NOT NULL DEFAULT '[]',
      position    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_api_environments_spec ON api_environments (spec_id, position);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_environments_name ON api_environments (spec_id, name);

    -- 실행 기록. **불변**이다 — 명세가 바뀌어도 지나간 관측은 그대로여야 판정의 기준이 된다.
    -- 비밀 표식 값은 여기 들어오기 전에 이미 가려져 있다(가린 뒤 저장, 저장 후 가리기 아님).
    CREATE TABLE IF NOT EXISTS api_runs (
      id             TEXT PRIMARY KEY,
      spec_id        TEXT NOT NULL,
      request_name   TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      environment_name TEXT NOT NULL,
      base_version   TEXT,
      status         TEXT NOT NULL,
      http_status    INTEGER,
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL,
      request_json   TEXT NOT NULL,
      response_json  TEXT,
      error          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_runs_spec ON api_runs (spec_id, created_at DESC);

    -- 판정·흡수 이력. 둘을 한 표에 두는 이유: "왜 이 필드가 명세에 있지" 를 되짚으려면
    -- 판정과 흡수가 **같은 타임라인**에 있어야 한다(spec logs.history AC-2). 이력은 불변이다.
    CREATE TABLE IF NOT EXISTS api_contract_logs (
      id               TEXT PRIMARY KEY,
      spec_id          TEXT NOT NULL,
      kind             TEXT NOT NULL,
      environment_id   TEXT,
      environment_name TEXT NOT NULL DEFAULT '',
      grade            TEXT,
      summary          TEXT NOT NULL,
      payload          TEXT NOT NULL,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_contract_logs_spec ON api_contract_logs (spec_id, created_at DESC);
  `
}
