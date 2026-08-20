import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing, type ServiceMigration } from './types'

/**
 * Infra 서비스의 로컬 저장소 스키마.
 *
 * 담는 것은 **설계본과 카탈로그**다 — Rockury 는 인프라를 구축하지 않고, 설계를 들고 있다가
 * 실물과 대조만 한다(공통 불변식).
 * 실물 스냅샷(M2)·미들웨어(M5) 테이블은 그 마일스톤에서 여기에 더한다.
 *
 * 모든 이름은 `infra_` 접두어 — 서비스끼리 겹치면 앱이 안 켜진다(네임스페이스 규칙).
 */
export const infraMigration: ServiceMigration = {
  service: 'infra',
  tables: [
    'infra_catalogs',
    'infra_providers',
    'infra_designs',
    'infra_nodes',
    'infra_edges',
    'infra_runs',
    'infra_snapshots',
    'infra_snapshot_probes',
    'infra_resources',
    'infra_mw_connections'
  ],

  schema: `
    -- 카탈로그: 노드 종류를 코드가 아니라 데이터로 둔 파일 한 벌.
    -- source 로 내장/내가 만듦/가져옴을 가른다 — 가져온 것은 화면에서 계속 그렇게 보인다(신뢰 경계).
    CREATE TABLE IF NOT EXISTS infra_catalogs (
      id              TEXT PRIMARY KEY,
      source          TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      schema_version  INTEGER NOT NULL,
      catalog_version TEXT NOT NULL,
      body            TEXT NOT NULL,
      imported_at     TEXT,
      approved_at     TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_infra_catalogs_provider ON infra_catalogs(provider_id);

    -- 공급자 연결: 카탈로그가 선언한 자격증명 칸을 채운 것.
    -- cred_encrypted 는 OS 키체인 암호문 — 평문은 어떤 컬럼에도 들어가지 않는다.
    CREATE TABLE IF NOT EXISTS infra_providers (
      id             TEXT PRIMARY KEY,
      catalog_id     TEXT NOT NULL,
      name           TEXT NOT NULL,
      cred_encrypted TEXT NOT NULL DEFAULT '',
      read_only      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_infra_providers_catalog ON infra_providers(catalog_id);

    -- 설계본: 이 서비스의 정본. 실물과 독립적으로 존재한다.
    CREATE TABLE IF NOT EXISTS infra_designs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- 설계 노드. 좌표는 부모 기준 상대값(@xyflow 규약) — 부모를 옮기면 자식이 코드 없이 따라온다.
    -- catalog_version 을 함께 남기는 이유: 종류가 카탈로그에서 사라져도 "언제 기준의 무엇이었는지"가
    -- 남아 노드를 지우지 않아도 된다.
    CREATE TABLE IF NOT EXISTS infra_nodes (
      id              TEXT PRIMARY KEY,
      design_id       TEXT NOT NULL,
      type_id         TEXT,
      name            TEXT NOT NULL DEFAULT '',
      parent_id       TEXT,
      pos_x           REAL NOT NULL DEFAULT 0,
      pos_y           REAL NOT NULL DEFAULT 0,
      size_w          REAL NOT NULL DEFAULT 200,
      size_h          REAL NOT NULL DEFAULT 60,
      doc             TEXT NOT NULL DEFAULT '{}',
      catalog_version TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_infra_nodes_design ON infra_nodes(design_id);
    CREATE INDEX IF NOT EXISTS idx_infra_nodes_parent ON infra_nodes(parent_id);

    CREATE TABLE IF NOT EXISTS infra_edges (
      id        TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label     TEXT NOT NULL DEFAULT '',
      kind      TEXT NOT NULL DEFAULT 'calls'
    );
    CREATE INDEX IF NOT EXISTS idx_infra_edges_design ON infra_edges(design_id);

    -- 실행 이력: 언제 무엇을 돌렸나. **자격증명 값은 남기지 않는다** — 참조 형태로만 기록한다.
    CREATE TABLE IF NOT EXISTS infra_runs (
      id          TEXT PRIMARY KEY,
      provider_id TEXT,
      kind        TEXT NOT NULL,
      cmd         TEXT NOT NULL,
      args        TEXT NOT NULL DEFAULT '[]',
      ok          INTEGER NOT NULL DEFAULT 0,
      exit_code   INTEGER,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error       TEXT NOT NULL DEFAULT '',
      ran_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_infra_runs_at ON infra_runs(ran_at);

    -- 실물 스냅샷 회차. 클라우드는 느리므로 읽은 것을 여기 담아 두고 화면은 "○분 전 기준"을 붙인다.
    CREATE TABLE IF NOT EXISTS infra_snapshots (
      id          TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      taken_at    TEXT NOT NULL,
      ok          INTEGER NOT NULL DEFAULT 0,
      error       TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_infra_snapshots_provider ON infra_snapshots(provider_id, taken_at);

    -- 회차 안에서 탐침 하나하나의 결과.
    -- **이 표가 없으면 "0건이었다"와 "못 읽었다"를 구분할 수 없다** — 그러면 멀쩡한 인프라가
    -- '미구축'으로 보이고 사용자가 지우러 간다. 대조의 '대조 안 함' 판정이 여기에 선다.
    CREATE TABLE IF NOT EXISTS infra_snapshot_probes (
      snapshot_id TEXT NOT NULL,
      type_id     TEXT NOT NULL,
      ok          INTEGER NOT NULL DEFAULT 0,
      count       INTEGER NOT NULL DEFAULT 0,
      error       TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (snapshot_id, type_id)
    );

    -- 읽어 온 실물. status 는 사전을 거친 값, raw_status 는 원본 문자열 — 둘 다 남긴다.
    CREATE TABLE IF NOT EXISTS infra_resources (
      id                  TEXT PRIMARY KEY,
      snapshot_id         TEXT NOT NULL,
      type_id             TEXT NOT NULL,
      external_id         TEXT NOT NULL,
      name                TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'unknown',
      raw_status          TEXT NOT NULL DEFAULT '',
      parent_external_id  TEXT,
      design_node_ref     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_infra_resources_snapshot ON infra_resources(snapshot_id);

    -- 미들웨어 접속(M5). DB 서비스의 Connections 패턴을 빌린다 — 새로 발명하지 않는다.
    -- secret_encrypted 는 비밀번호·토큰의 OS 키체인 암호문. **평문 컬럼은 없다**(공급자 연결과 같은 규칙).
    CREATE TABLE IF NOT EXISTS infra_mw_connections (
      id               TEXT PRIMARY KEY,
      kind             TEXT NOT NULL,              -- redis | rabbitmq | kafka | mqtt
      name             TEXT NOT NULL,
      host             TEXT NOT NULL,
      port             INTEGER NOT NULL,
      username         TEXT NOT NULL DEFAULT '',
      secret_encrypted TEXT NOT NULL DEFAULT '',
      options          TEXT NOT NULL DEFAULT '{}', -- 종류별 자잘한 설정(db 번호 등)
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_infra_mw_kind ON infra_mw_connections(kind);
  `,

  alter(d: DatabaseSync): void {
    // 공용 projects 의 소속. **비워 둘 수 있다(무소속)**.
    // 설계본 하나 + 밖에 붙는 접속 둘에만 붙인다. 노드·연결선·실물 스냅샷은 설계본이나 공급자를
    // 타고 프로젝트가 정해지고, 카탈로그(노드 종류 정의)는 프로젝트와 무관한 전역 지식이라 대상이 아니다.
    addColumnIfMissing(d, 'infra_designs', 'project_id', 'TEXT')
    addColumnIfMissing(d, 'infra_providers', 'project_id', 'TEXT')
    addColumnIfMissing(d, 'infra_mw_connections', 'project_id', 'TEXT')
  }
}
