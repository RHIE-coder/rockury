import type { ServiceMigration } from './types'

/**
 * UI/UX 서비스의 로컬 저장소 스키마 — 명세 정본 `docs/spec/uiux-ia.md` §7.
 *
 * 설계 대상의 위계는 6층(Project > Application > Service > Surface > Section > Component)인데
 * **행으로 두는 건 위 네 층뿐**이다. 화면 안(Section·Component)은 트리라서 관계로 펴면 조인
 * 지옥이 되고, 편집 단위도 버전 스냅샷 단위도 화면 하나라 `content` JSON 한 칸에 담는다
 * (DB 서비스가 테이블의 컬럼·제약을 JSON 칸에 두는 것과 같은 판단).
 *
 * `key` 는 안정 주소의 조각이다 — 이어 붙이면 `coupang.buyer.auth.login`. 흐름의 도착점·
 * 규칙의 대상·핀 코멘트가 전부 이 주소에 걸리므로 **같은 부모 아래 유일해야 한다(INV-1)**.
 * 그 유일성은 주석이 아니라 UNIQUE 인덱스가 강제한다.
 */
export const uiuxMigration: ServiceMigration = {
  service: 'uiux',
  tables: [
    'uiux_projects',
    'uiux_applications',
    'uiux_services',
    'uiux_surfaces',
    'uiux_versions',
    'uiux_notes'
  ],

  schema: `
    CREATE TABLE IF NOT EXISTS uiux_projects (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uiux_projects_key ON uiux_projects(key);

    CREATE TABLE IF NOT EXISTS uiux_applications (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL,
      key         TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position    INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uiux_applications_key ON uiux_applications(project_id, key);

    CREATE TABLE IF NOT EXISTS uiux_services (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      key            TEXT NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      position       INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uiux_services_key ON uiux_services(application_id, key);

    -- content: 섹션·컴포넌트·이벤트·뷰포트 덮어쓰기 트리. 깨져도 목록·주소·상태는 읽혀야 하므로
    --          읽는 쪽(services/uiux/content.ts)이 방어 파싱한다(INV-3).
    -- status : 설계가 어디까지 왔나. 판정은 에이전트가 하고 여기는 받아 적는다(§8).
    CREATE TABLE IF NOT EXISTS uiux_surfaces (
      id           TEXT PRIMARY KEY,
      service_id   TEXT NOT NULL,
      key          TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      kind         TEXT NOT NULL DEFAULT 'page',
      position     INTEGER NOT NULL DEFAULT 0,
      content      TEXT NOT NULL DEFAULT '{"sections":[]}',
      status       TEXT NOT NULL DEFAULT 'designed',
      checked_at   TEXT NOT NULL DEFAULT '',
      checked_by   TEXT NOT NULL DEFAULT '',
      checked_note TEXT NOT NULL DEFAULT '',
      updated_at   TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uiux_surfaces_key ON uiux_surfaces(service_id, key);

    -- 화면 위에 남기는 의견(핀). target 은 **요소 id**(빈 값이면 화면 전체)다 — 좌표를 쓰지 않는
    -- 이유는 배치가 바뀌면 좌표가 떠내려가기 때문. 요소에 붙으면 화면이 어떻게 접히든 따라간다.
    -- 스크린샷에 화살표를 그려 보내던 일을 대신하는 자리다.
    CREATE TABLE IF NOT EXISTS uiux_notes (
      id         TEXT PRIMARY KEY,
      surface_id TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL,
      author     TEXT NOT NULL DEFAULT '',
      resolved   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uiux_notes_surface ON uiux_notes(surface_id);

    CREATE TABLE IF NOT EXISTS uiux_versions (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number     TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      snapshot   TEXT NOT NULL,
      locked     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uiux_versions_project ON uiux_versions(project_id);
  `
}
