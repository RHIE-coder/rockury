import type { DatabaseSync } from 'node:sqlite'

/**
 * 프로젝트를 UI/UX 전용에서 **공용**으로 올린다 — `uiux_projects` → `projects`.
 *
 * 프로젝트는 원래 UI/UX 위계의 맨 위층이었는데(Project > Application > Service > Surface),
 * 다섯 서비스가 함께 쓰는 범위가 되면서 한 서비스가 소유할 수 없게 됐다. 같은 이름이 두 뜻을
 * 갖는 것을 피하려고 새 그릇을 만드는 대신 **있던 것을 옮긴다**.
 *
 * **id 를 그대로 보존한다** — `uiux_applications.project_id` 와 `uiux_versions.project_id` 가
 * 이 값을 가리킨다. 새 id 를 발급하면 화면 설계 트리 전체가 부모를 잃는다.
 *
 * 디자인 토큰은 따라오지 않고 `uiux_project_tokens` 로 갈라진다. UI/UX 전용 값이라
 * 공용 테이블에 두면 서비스마다 전용 칸이 하나씩 붙어 잡동사니가 된다.
 */
export function promoteProjectsToShared(d: DatabaseSync): void {
  if (!tableExists(d, 'uiux_projects')) return

  // 몇 번을 돌려도 결과가 같아야 한다 — 앱을 켤 때마다 지나가는 자리다.
  // OR IGNORE: 반쯤 이관된 DB 에서 다시 돌 때 사용자가 그 사이 고친 값을 옛 값으로 되돌리지 않는다.
  d.exec('BEGIN')
  try {
    d.exec(`
      INSERT OR IGNORE INTO projects (id, key, name, description, created_at)
      SELECT id, key, name, description, created_at FROM uiux_projects
    `)
    // tokens 는 나중에 ALTER 로 붙은 칸이라 그 전에 만들어진 로컬 DB 에는 없다.
    if (columnExists(d, 'uiux_projects', 'tokens')) {
      d.exec(`
        INSERT OR IGNORE INTO uiux_project_tokens (project_id, tokens)
        SELECT id, tokens FROM uiux_projects WHERE tokens <> '{}' AND tokens <> ''
      `)
    }
    d.exec('DROP TABLE uiux_projects')
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function tableExists(d: DatabaseSync, name: string): boolean {
  return !!d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
}

function columnExists(d: DatabaseSync, table: string, column: string): boolean {
  // table 은 호출부의 하드코딩 리터럴이라 인터폴레이션 안전(사용자 입력 경로 없음).
  const r = d
    .prepare(`SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name=?`)
    .get(column) as unknown as { c: number }
  return r.c > 0
}
