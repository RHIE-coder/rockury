import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 프로젝트 — 다섯 서비스가 함께 쓰는 **범위**. 어느 서비스도 소유하지 않는 공용 저장소다
 * (스키마는 `store/migrations/shell.ts`).
 *
 * 소속은 각 서비스의 "목록 맨 위에 이름으로 뜨는 것"에만 붙는다(설계·접속·명세·설계본).
 * 그 안에 든 것은 부모를 타고 프로젝트가 정해지므로 칸을 두지 않는다.
 */
export interface ProjectRow {
  id: string
  key: string
  name: string
  description: string
  created_at: string
}

/** 소속 칸을 가진 테이블 전수 — 프로젝트를 지울 때 이 칸들을 비운다. */
const SCOPED_TABLES = [
  'designs',
  'connections',
  'api_specs',
  'infra_designs',
  'infra_providers',
  'infra_mw_connections'
] as const

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export function listProjects(): ProjectRow[] {
  return getDb()
    .prepare('SELECT id, key, name, description, created_at FROM projects ORDER BY created_at ASC')
    .all() as unknown as ProjectRow[]
}

export function getProject(id: string): ProjectRow | null {
  return (getDb()
    .prepare('SELECT id, key, name, description, created_at FROM projects WHERE id = ?')
    .get(id) ?? null) as unknown as ProjectRow | null
}

/**
 * 키 유일성은 UNIQUE 인덱스가 최종 강제하지만 **여기서 먼저 본다** — 인덱스가 던지는 문구는
 * 사람이 읽을 수 없어서, 그대로 화면에 올리면 무엇이 잘못됐는지 알 수 없다.
 */
export function createProject(input: {
  key: string
  name: string
  description?: string
}): ProjectRow {
  const key = input.key.trim()
  assertKey(key)
  if (findByKey(key)) throw new Error(`이미 있는 프로젝트 키입니다: ${key}`)

  const row: ProjectRow = {
    id: randomUUID(),
    key,
    name: input.name.trim() || key,
    description: (input.description ?? '').trim(),
    created_at: new Date().toISOString()
  }
  getDb()
    .prepare('INSERT INTO projects (id, key, name, description, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.key, row.name, row.description, row.created_at)
  return row
}

export function updateProject(
  id: string,
  patch: { key?: string; name?: string; description?: string }
): void {
  const d = getDb()
  if (patch.key !== undefined) {
    const key = patch.key.trim()
    assertKey(key)
    const clash = findByKey(key)
    if (clash && clash.id !== id) throw new Error(`이미 있는 프로젝트 키입니다: ${key}`)
    d.prepare('UPDATE projects SET key = ? WHERE id = ?').run(key, id)
  }
  if (patch.name !== undefined)
    d.prepare('UPDATE projects SET name = ? WHERE id = ?').run(patch.name.trim(), id)
  if (patch.description !== undefined)
    d.prepare('UPDATE projects SET description = ? WHERE id = ?').run(patch.description.trim(), id)
}

/**
 * 프로젝트를 지운다. **소속됐던 설계·접속·명세는 지우지 않고 무소속으로 되돌린다.**
 *
 * 프로젝트는 범위를 나누는 이름표일 뿐이고, 그 안의 DB 설계는 훨씬 무거운 산출물이다.
 * 이름표를 떼는 일에 딸려 지워지면 되돌릴 방법이 없다. (UI/UX 위계는 예외 — 거기서는
 * 프로젝트가 곧 트리의 뿌리라 앱·화면이 부모를 잃으면 유령이 된다. `uiuxSpecs.deleteNode` 가
 * 자기 아래를 먼저 지우고 이 함수를 부른다.)
 */
export function deleteProject(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    releaseScopedRefs(d, id)
    d.prepare('DELETE FROM projects WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/** 이 프로젝트를 가리키던 소속 칸을 전부 비운다(= 무소속으로 되돌린다). */
export function releaseScopedRefs(d: ReturnType<typeof getDb>, projectId: string): void {
  for (const t of SCOPED_TABLES) {
    // t 는 위 상수 배열의 리터럴이라 인터폴레이션 안전(사용자 입력 경로 없음).
    d.prepare(`UPDATE ${t} SET project_id = NULL WHERE project_id = ?`).run(projectId)
  }
}

function findByKey(key: string): ProjectRow | null {
  return (getDb()
    .prepare('SELECT id, key, name, description, created_at FROM projects WHERE key = ?')
    .get(key) ?? null) as unknown as ProjectRow | null
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `프로젝트 키는 소문자·숫자로 시작하고 소문자·숫자·"-"·"_" 만 쓸 수 있습니다: ${key}`
    )
  }
}
