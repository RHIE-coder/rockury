import { addColumnIfMissing, type ServiceMigration } from './types'

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
    --
    -- 단발 실행과 스트림 세션이 **같은 표**에 사는 이유: 둘 다 "한 번 관측한 것"이고,
    -- 판정·기록 열람·MCP 가 한 목록으로 읽어야 한다(spec stream.session AC-6).
    -- 대신 shape 칸으로 갈라 둔다 — 이게 없으면 판정이 메시지 목록을 응답 본문으로 오독한다.
    CREATE TABLE IF NOT EXISTS api_runs (
      id             TEXT PRIMARY KEY,
      spec_id        TEXT NOT NULL,
      request_name   TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      environment_name TEXT NOT NULL,
      base_version   TEXT,
      shape          TEXT NOT NULL DEFAULT 'unary',
      call_json      TEXT NOT NULL DEFAULT '{}',
      status         TEXT NOT NULL,
      http_status    INTEGER,
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL,
      request_json   TEXT NOT NULL,
      response_json  TEXT,
      messages_json  TEXT,
      message_count  INTEGER,
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
  `,

  /**
   * 구 스키마 보정 — `CREATE TABLE IF NOT EXISTS` 는 이미 있는 표에 칸을 못 더한다.
   * 스트림 세션이 생기기 전에 만들어진 로컬 DB 는 `shape`·`messages_json` 이 없어서
   * 앱을 켜자마자 기록 조회가 터진다. 지나간 기록은 전부 단발 실행이므로 기본값이 맞다.
   */
  alter: (d) => {
    // api_specs.project_id — 공용 projects 의 소속. **비워 둘 수 있다(무소속)**.
    // 명세에만 붙인다: 요청·환경·버전·실행기록은 전부 명세에 딸려 있어 부모를 타고 정해진다.
    addColumnIfMissing(d, 'api_specs', 'project_id', 'TEXT')

    addColumnIfMissing(d, 'api_runs', 'shape', "TEXT NOT NULL DEFAULT 'unary'")
    addColumnIfMissing(d, 'api_runs', 'messages_json', 'TEXT')
    // 목록 조회가 메시지 본문을 안 읽으려면 건수만 따로 있어야 한다(본문 5,000건을 매번
    // 파싱하면 메인 프로세스가 초 단위로 멈춘다 — 실측).
    addColumnIfMissing(d, 'api_runs', 'message_count', 'INTEGER')
    // 그때 넣은 호출 파라미터. 없으면 "같은 파라미터로 다시 실행" 을 못 한다 —
    // 조립된 주소에서는 되돌릴 수 없다(치환은 한 방향이다).
    addColumnIfMissing(d, 'api_runs', 'call_json', "TEXT NOT NULL DEFAULT '{}'")
  }
}
