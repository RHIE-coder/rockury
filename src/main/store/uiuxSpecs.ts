import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * UI/UX 설계 저장소 — 명세 정본 `docs/spec/uiux-ia.md` §7.
 *
 * 위계 네 층(Project > Application > Service > Surface)이 행이고, 화면 안(Section·Component)은
 * `surfaces.content` JSON 한 칸이다. 층마다 CRUD 를 따로 쓰지 않고 **`level` 을 받는 한 벌**로 두는
 * 이유: 세 층의 모양이 같아서(`key`·`name`·`description`·부모·순서) 따로 두면 같은 코드가 세 번
 * 복제되고, 규칙(주소 유일성·연쇄 삭제)이 한 곳에서 어긋난다.
 */

export type SpecLevel = 'project' | 'application' | 'service' | 'surface'

export interface SpecProjectRow {
  id: string
  key: string
  name: string
  description: string
  created_at: string
}

export interface SpecApplicationRow {
  id: string
  project_id: string
  key: string
  name: string
  description: string
  position: number
}

export interface SpecServiceRow {
  id: string
  application_id: string
  key: string
  name: string
  description: string
  position: number
}

export interface SpecSurfaceRow {
  id: string
  service_id: string
  key: string
  name: string
  description: string
  kind: string
  position: number
  content: string
  status: string
  checked_at: string
  checked_by: string
  checked_note: string
  updated_at: string
}

/** 한 프로젝트의 위계 전부 — Features 인덱스·Spec 트리가 한 번에 받는다. */
export interface SpecTree {
  applications: SpecApplicationRow[]
  services: SpecServiceRow[]
  surfaces: SpecSurfaceRow[]
}

export interface NodeInput {
  key: string
  name: string
  description?: string
  /** surface 전용. 없으면 `page`. */
  kind?: string
}

/** 층별 테이블·부모 칸 — level 하나로 갈리는 지점을 여기 한 곳에 모은다. */
const TABLE: Record<SpecLevel, { name: string; parent: string | null }> = {
  project: { name: 'uiux_projects', parent: null },
  application: { name: 'uiux_applications', parent: 'project_id' },
  service: { name: 'uiux_services', parent: 'application_id' },
  surface: { name: 'uiux_surfaces', parent: 'service_id' }
}

/** 그 층의 자식 층 — 연쇄 삭제(INV-4)가 타고 내려간다. */
const CHILD: Partial<Record<SpecLevel, SpecLevel>> = {
  project: 'application',
  application: 'service',
  service: 'surface'
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export function listProjects(): SpecProjectRow[] {
  return getDb()
    .prepare('SELECT id, key, name, description, created_at FROM uiux_projects ORDER BY created_at ASC')
    .all() as unknown as SpecProjectRow[]
}

/**
 * 프로젝트 하나의 위계 전부. 층마다 한 번씩, 세 번의 조회로 끝낸다 — 화면이 트리를 조립한다
 * (중첩 조인으로 한 번에 받으면 빈 앱·빈 서비스가 결과에서 사라진다).
 */
export function getTree(projectId: string): SpecTree {
  const d = getDb()
  const applications = d
    .prepare(
      'SELECT id, project_id, key, name, description, position FROM uiux_applications WHERE project_id = ? ORDER BY position ASC, key ASC'
    )
    .all(projectId) as unknown as SpecApplicationRow[]

  const appIds = applications.map((a) => a.id)
  const services = appIds.length
    ? (d
        .prepare(
          `SELECT id, application_id, key, name, description, position FROM uiux_services
           WHERE application_id IN (${appIds.map(() => '?').join(',')}) ORDER BY position ASC, key ASC`
        )
        .all(...appIds) as unknown as SpecServiceRow[])
    : []

  const svcIds = services.map((s) => s.id)
  const surfaces = svcIds.length
    ? (d
        .prepare(
          `SELECT id, service_id, key, name, description, kind, position, content, status,
                  checked_at, checked_by, checked_note, updated_at
           FROM uiux_surfaces
           WHERE service_id IN (${svcIds.map(() => '?').join(',')}) ORDER BY position ASC, key ASC`
        )
        .all(...svcIds) as unknown as SpecSurfaceRow[])
    : []

  return { applications, services, surfaces }
}

/**
 * 노드 하나를 만든다. 주소 유일성(INV-1)은 UNIQUE 인덱스가 최종 강제하지만 **여기서 먼저 본다** —
 * 인덱스가 던지는 문구는 사람이 읽을 수 없어서, 그대로 화면에 올리면 무엇이 잘못됐는지 알 수 없다.
 */
export function createNode(level: SpecLevel, parentId: string | null, input: NodeInput): { id: string } {
  const t = TABLE[level]
  if (t.parent && !parentId) throw new Error(`${level} 은(는) 부모가 필요합니다.`)
  assertKey(input.key)
  assertKeyFree(level, parentId, input.key)

  const d = getDb()
  const id = randomUUID()
  const name = input.name.trim() || input.key
  const description = (input.description ?? '').trim()

  if (level === 'project') {
    d.prepare(
      'INSERT INTO uiux_projects (id, key, name, description, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, input.key, name, description, new Date().toISOString())
    return { id }
  }

  const position = nextPosition(level, parentId as string)
  if (level === 'surface') {
    d.prepare(
      `INSERT INTO uiux_surfaces (id, service_id, key, name, description, kind, position, content, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{"sections":[]}', 'designed', ?)`
    ).run(id, parentId, input.key, name, description, input.kind ?? 'page', position, new Date().toISOString())
    return { id }
  }

  d.prepare(
    `INSERT INTO ${t.name} (id, ${t.parent}, key, name, description, position) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, parentId, input.key, name, description, position)
  return { id }
}

/** 이름·설명·(화면이면) 종류를 고친다. `key` 변경은 주소가 바뀌는 일이라 따로 다룬다(아래). */
export function updateNode(
  level: SpecLevel,
  id: string,
  patch: { name?: string; description?: string; kind?: string; key?: string }
): void {
  const d = getDb()
  const t = TABLE[level]

  if (patch.key !== undefined) {
    assertKey(patch.key)
    const parentId = t.parent
      ? ((d.prepare(`SELECT ${t.parent} AS p FROM ${t.name} WHERE id = ?`).get(id) as unknown as {
          p: string
        } | undefined)?.p ?? null)
      : null
    assertKeyFree(level, parentId, patch.key, id)
    d.prepare(`UPDATE ${t.name} SET key = ? WHERE id = ?`).run(patch.key, id)
  }
  if (patch.name !== undefined) d.prepare(`UPDATE ${t.name} SET name = ? WHERE id = ?`).run(patch.name.trim(), id)
  if (patch.description !== undefined)
    d.prepare(`UPDATE ${t.name} SET description = ? WHERE id = ?`).run(patch.description.trim(), id)
  if (patch.kind !== undefined && level === 'surface')
    d.prepare('UPDATE uiux_surfaces SET kind = ? WHERE id = ?').run(patch.kind, id)
}

/**
 * 노드와 그 아래 전부를 지운다(INV-4). 부모 없는 화면은 주소를 만들 수 없어 유령이 된다.
 * 트랜잭션으로 묶는 이유: 중간에 실패하면 절반만 지워진 트리가 남는다.
 */
export function deleteNode(level: SpecLevel, id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    deleteSubtree(level, [id])
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function deleteSubtree(level: SpecLevel, ids: string[]): void {
  if (ids.length === 0) return
  const d = getDb()
  // 화면에 붙은 의견도 함께 지운다 — 화면이 사라지면 그 의견은 가리킬 곳이 없어 유령이 된다.
  if (level === 'surface') {
    d.prepare(`DELETE FROM uiux_notes WHERE surface_id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  }
  const child = CHILD[level]
  if (child) {
    const ct = TABLE[child]
    const rows = d
      .prepare(`SELECT id FROM ${ct.name} WHERE ${ct.parent} IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as unknown as { id: string }[]
    deleteSubtree(child, rows.map((r) => r.id))
  }
  d.prepare(`DELETE FROM ${TABLE[level].name} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
}

/** 안정 주소로 찾은 결과 — 층마다 id 와 key 를 함께 준다(에이전트가 다음 호출에 쓴다). */
export interface AddressHit {
  projectId: string
  applicationId?: string
  serviceId?: string
  surfaceId?: string
  level: SpecLevel
}

/**
 * 안정 주소(`coupang.buyer.auth.login`)로 노드를 찾는다 — **에이전트의 주 진입로**다.
 * 저장소 id 는 무작위라 밖에서 알 수 없고, 주소는 사람도 에이전트도 읽고 쓸 수 있다.
 * 조각이 1~4개면 그 깊이까지 찾고, 도중에 끊기면 null(어디서 끊겼는지는 부르는 쪽이 알린다).
 */
export function findByAddress(address: string): AddressHit | null {
  const parts = address.split('.').filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return null
  const d = getDb()

  const project = d.prepare('SELECT id FROM uiux_projects WHERE key = ?').get(parts[0]) as unknown as
    | { id: string }
    | undefined
  if (!project) return null
  if (parts.length === 1) return { projectId: project.id, level: 'project' }

  const app = d
    .prepare('SELECT id FROM uiux_applications WHERE project_id = ? AND key = ?')
    .get(project.id, parts[1]) as unknown as { id: string } | undefined
  if (!app) return null
  if (parts.length === 2) return { projectId: project.id, applicationId: app.id, level: 'application' }

  const svc = d
    .prepare('SELECT id FROM uiux_services WHERE application_id = ? AND key = ?')
    .get(app.id, parts[2]) as unknown as { id: string } | undefined
  if (!svc) return null
  if (parts.length === 3)
    return { projectId: project.id, applicationId: app.id, serviceId: svc.id, level: 'service' }

  const surface = d
    .prepare('SELECT id FROM uiux_surfaces WHERE service_id = ? AND key = ?')
    .get(svc.id, parts[3]) as unknown as { id: string } | undefined
  if (!surface) return null
  return {
    projectId: project.id,
    applicationId: app.id,
    serviceId: svc.id,
    surfaceId: surface.id,
    level: 'surface'
  }
}

/** 화면 한 장을 통째로(내용 포함) 읽는다. 주소로 찾은 뒤 부른다. */
export function getSurface(id: string): SpecSurfaceRow | null {
  return (getDb()
    .prepare(
      `SELECT id, service_id, key, name, description, kind, position, content, status,
              checked_at, checked_by, checked_note, updated_at
       FROM uiux_surfaces WHERE id = ?`
    )
    .get(id) ?? null) as unknown as SpecSurfaceRow | null
}

/** 화면 내용(JSON 문자열) 저장. 파싱·검증은 렌더러의 `content.ts` 몫이라 여긴 그대로 싣는다. */
export function saveSurfaceContent(id: string, content: string): void {
  getDb()
    .prepare('UPDATE uiux_surfaces SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, new Date().toISOString(), id)
}

/** 상태 칸 기록(§8) — 판정은 에이전트가 하고 여기는 받아 적는다. */
export function setSurfaceStatus(
  id: string,
  status: string,
  by: string,
  note: string
): void {
  getDb()
    .prepare(
      'UPDATE uiux_surfaces SET status = ?, checked_at = ?, checked_by = ?, checked_note = ? WHERE id = ?'
    )
    .run(status, new Date().toISOString(), by, note, id)
}

// ── 버전(스냅샷) ────────────────────────────────────────────────────

export interface SpecVersionRow {
  id: string
  project_id: string
  number: string
  note: string
  snapshot: string
  locked: number
  created_at: string
}

/** 최신 버전이 먼저 — 목록에서 방금 컷한 것이 맨 위에 보여야 한다. */
export function listVersions(projectId: string): Omit<SpecVersionRow, 'snapshot'>[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, number, note, locked, created_at FROM uiux_versions
       WHERE project_id = ? ORDER BY created_at DESC`
    )
    .all(projectId) as unknown as Omit<SpecVersionRow, 'snapshot'>[]
}

export function getVersion(id: string): SpecVersionRow | null {
  return (getDb()
    .prepare('SELECT id, project_id, number, note, snapshot, locked, created_at FROM uiux_versions WHERE id = ?')
    .get(id) ?? null) as unknown as SpecVersionRow | null
}

export function createVersion(input: {
  projectId: string
  number: string
  note?: string
  snapshot: string
}): { id: string } {
  const id = randomUUID()
  getDb()
    .prepare(
      'INSERT INTO uiux_versions (id, project_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    )
    .run(id, input.projectId, input.number, input.note ?? '', input.snapshot, new Date().toISOString())
  return { id }
}

export function deleteVersion(id: string): void {
  getDb().prepare('DELETE FROM uiux_versions WHERE id = ?').run(id)
}

// ── 디자인 토큰 ─────────────────────────────────────────────────────

/**
 * 프로젝트가 덮어쓴 토큰만 반환한다(전부가 아니라 **차이만**). 기본 한 벌과의 병합은 렌더러가
 * 한다 — 기본값이 바뀌면 안 건드린 토큰은 자동으로 따라와야 하고, 전부를 복사해 두면 그게 막힌다.
 */
export function getProjectTokens(projectId: string): Record<string, string> {
  const row = getDb().prepare('SELECT tokens FROM uiux_projects WHERE id = ?').get(projectId) as unknown as
    | { tokens: string }
    | undefined
  if (!row) return {}
  try {
    const parsed = JSON.parse(row.tokens || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    // 값은 CSS 에 그대로 들어가므로 문자열만 살린다.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
    ) as Record<string, string>
  } catch {
    return {}
  }
}

export function setProjectTokens(projectId: string, tokens: Record<string, string>): void {
  getDb().prepare('UPDATE uiux_projects SET tokens = ? WHERE id = ?').run(JSON.stringify(tokens), projectId)
}

// ── 의견(핀) ────────────────────────────────────────────────────────

export interface SpecNoteRow {
  id: string
  surface_id: string
  /** 요소 id. 빈 값이면 화면 전체에 붙은 의견. */
  target: string
  body: string
  author: string
  resolved: number
  created_at: string
}

/** 화면 하나의 의견. 미해결이 먼저, 그 안에서는 오래된 것부터(대화 순서). */
export function listNotes(surfaceId: string): SpecNoteRow[] {
  return getDb()
    .prepare(
      `SELECT id, surface_id, target, body, author, resolved, created_at FROM uiux_notes
       WHERE surface_id = ? ORDER BY resolved ASC, created_at ASC`
    )
    .all(surfaceId) as unknown as SpecNoteRow[]
}

/** 프로젝트 전체의 **미해결** 의견 — 에이전트가 "지금 무엇을 고쳐야 하나"를 한 번에 받는다. */
export function listOpenNotes(projectId: string): (SpecNoteRow & { surface_key: string })[] {
  return getDb()
    .prepare(
      `SELECT n.id, n.surface_id, n.target, n.body, n.author, n.resolved, n.created_at, s.key AS surface_key
       FROM uiux_notes n
       JOIN uiux_surfaces s ON s.id = n.surface_id
       JOIN uiux_services sv ON sv.id = s.service_id
       JOIN uiux_applications a ON a.id = sv.application_id
       WHERE a.project_id = ? AND n.resolved = 0
       ORDER BY n.created_at ASC`
    )
    .all(projectId) as unknown as (SpecNoteRow & { surface_key: string })[]
}

export function createNote(input: {
  surfaceId: string
  target?: string
  body: string
  author?: string
}): { id: string } {
  const body = input.body.trim()
  if (!body) throw new Error('빈 의견은 남길 수 없습니다.')
  const id = randomUUID()
  getDb()
    .prepare(
      'INSERT INTO uiux_notes (id, surface_id, target, body, author, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    )
    .run(id, input.surfaceId, input.target ?? '', body, input.author ?? '', new Date().toISOString())
  return { id }
}

/** 해결/미해결 토글. 지우지 않고 표시만 바꾸는 이유: 무엇을 왜 고쳤는지가 이력으로 남아야 한다. */
export function setNoteResolved(id: string, resolved: boolean): void {
  getDb().prepare('UPDATE uiux_notes SET resolved = ? WHERE id = ?').run(resolved ? 1 : 0, id)
}

export function deleteNote(id: string): void {
  getDb().prepare('DELETE FROM uiux_notes WHERE id = ?').run(id)
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `주소 조각 '${key}' 은(는) 쓸 수 없습니다 — 소문자·숫자로 시작하고 소문자 영숫자와 하이픈(-)·밑줄(_)만 씁니다.`
    )
  }
}

function assertKeyFree(level: SpecLevel, parentId: string | null, key: string, exceptId?: string): void {
  const t = TABLE[level]
  const where = t.parent ? `${t.parent} = ? AND key = ?` : 'key = ?'
  const params = t.parent ? [parentId, key] : [key]
  const row = getDb()
    .prepare(`SELECT id FROM ${t.name} WHERE ${where}`)
    .get(...params) as unknown as { id: string } | undefined
  if (row && row.id !== exceptId) {
    throw new Error(`같은 자리에 '${key}' 가 이미 있습니다 — 주소는 유일해야 합니다.`)
  }
}

function nextPosition(level: SpecLevel, parentId: string): number {
  const t = TABLE[level]
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM ${t.name} WHERE ${t.parent} = ?`)
    .get(parentId) as unknown as { m: number }
  return row.m + 1
}
