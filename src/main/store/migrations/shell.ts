import type { ServiceMigration } from './types'
import { SHARED_OWNER } from './types'

/**
 * 공용 저장소 스키마 — 어느 서비스에도 속하지 않고 다섯이 **함께** 쓰는 것만 둔다.
 *
 * 지금은 프로젝트 하나뿐이다. 프로젝트는 "지금 보는 모든 것이 무엇에 속하나"를 정하는 범위라
 * 서비스 하나가 소유할 수 없다 — DB 설계도 API 명세도 인프라 설계본도 같은 프로젝트를 가리킨다.
 *
 * **레일의 여섯 번째 칸이 아니다.** 프로젝트는 하는 일이 아니라 범위라서, 화면으로 만들면
 * 그 화면을 떠나야 효력이 생기는 컨텍스트가 된다. 자리는 셸의 셀렉터 하나다.
 *
 * `key` 는 UI/UX 안정 주소의 첫 조각이다 — 이어 붙이면 `coupang.buyer.auth.login`.
 * 겹치면 한 주소가 두 프로젝트를 가리키므로 UNIQUE 인덱스가 강제한다.
 */
export const shellMigration: ServiceMigration = {
  service: SHARED_OWNER,
  tables: ['projects'],

  schema: `
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
  `
}
