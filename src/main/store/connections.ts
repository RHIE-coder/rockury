import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * Connection — 원시 접속 정보(엔드포인트/자격증명)의 1급 엔티티(§IA · 결정 B).
 *
 * 설계와 무관하게 존재한다. Remote(Object/Data/Query = 모니터링/조회)는 이것만으로 동작한다.
 * 배포/마이그레이션은 Environment(=Connection+Design+버전) 바인딩이 담당한다.
 * 비밀번호는 암호문만 저장하고 렌더러 레코드에는 노출하지 않는다.
 */
export type DbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'

export interface ConnectionRecord {
  id: string
  name: string
  dbType: DbType
  host: string
  port: number
  database: string
  user: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  /**
   * 범위(scope) — 이 연결에서 지금 보고 있는 스키마 목록.
   * 빈 배열이면 "기본 스키마 하나"다(PostgreSQL `current_schema()` · MySQL `DATABASE()`) —
   * 예전 연결은 전부 빈 배열이라 지금과 똑같이 동작한다.
   */
  schemas: string[]
  autoCheckDisabled: boolean
  groupId: string | null
  /**
   * 속한 프로젝트. null 이면 **공용** — 접속은 쓰는 도구라, 무소속은 어느 프로젝트에서나 보인다
   * (설계류와 갈리는 유일한 지점).
   */
  projectId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Connection 그룹 — 접속 카드 분류(1단계, 중첩 없음). */
export interface ConnectionGroupRecord {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateConnectionInput {
  name: string
  dbType: DbType
  host: string
  port: number
  database: string
  user: string
  encryptedPassword: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  schemas?: string[]
  autoCheckDisabled?: boolean
  /** 만들 때 보고 있던 프로젝트. 안 주면 공용. */
  projectId?: string | null
}

export type UpdateConnectionInput = Partial<{
  name: string
  dbType: DbType
  host: string
  port: number
  database: string
  user: string
  encryptedPassword: string
  sslEnabled: boolean
  sslConfig: Record<string, unknown>
  schemas: string[]
  autoCheckDisabled: boolean
  /** null 이면 공용으로 되돌린다. */
  projectId: string | null
}>

interface ConnRow {
  id: string
  name: string
  db_type: string
  host: string
  port: number
  database_name: string
  db_user: string
  encrypted_password: string
  ssl_enabled: number
  ssl_config: string | null
  schemas: string | null
  auto_check_disabled: number
  group_id: string | null
  project_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

interface GroupRow {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * 저장된 범위를 문자열 배열로 편다. 깨진 JSON·기대 밖 모양은 **빈 배열**로 떨어뜨린다 —
 * 범위를 못 읽었다고 앱이 안 켜지는 것보다, 기본 스키마 하나로 여는 편이 낫다.
 */
function parseSchemas(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toRecord(r: ConnRow): ConnectionRecord {
  return {
    id: r.id,
    name: r.name,
    dbType: r.db_type as DbType,
    host: r.host,
    port: r.port,
    database: r.database_name,
    user: r.db_user,
    sslEnabled: r.ssl_enabled === 1,
    sslConfig: r.ssl_config ? (JSON.parse(r.ssl_config) as Record<string, unknown>) : undefined,
    schemas: parseSchemas(r.schemas),
    autoCheckDisabled: r.auto_check_disabled === 1,
    groupId: r.group_id ?? null,
    projectId: r.project_id ?? null,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listConnections(): ConnectionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM connections ORDER BY sort_order ASC, created_at ASC')
    .all() as unknown as ConnRow[]
  return rows.map(toRecord)
}

export function getConnection(id: string): ConnectionRecord | null {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnRow | undefined
  return row ? toRecord(row) : null
}

/** 내부 서비스용 — 암호문 포함(연결 테스트/조회/실행 직전 복호화). 렌더러 노출 금지. */
export function getConnectionWithPassword(
  id: string
): (ConnectionRecord & { encryptedPassword: string }) | null {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnRow | undefined
  if (!row) return null
  return { ...toRecord(row), encryptedPassword: row.encrypted_password }
}

export function createConnection(input: CreateConnectionInput): ConnectionRecord {
  const d = getDb()
  const id = `conn_${randomUUID()}`
  const now = new Date().toISOString()
  const { max } = d
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM connections')
    .get() as unknown as { max: number }

  d.prepare(
    `INSERT INTO connections
       (id, name, db_type, host, port, database_name, db_user, encrypted_password,
        ssl_enabled, ssl_config, schemas, auto_check_disabled, project_id, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.dbType,
    input.host,
    input.port,
    input.database,
    input.user,
    input.encryptedPassword,
    input.sslEnabled ? 1 : 0,
    input.sslConfig ? JSON.stringify(input.sslConfig) : null,
    JSON.stringify(input.schemas ?? []),
    input.autoCheckDisabled ? 1 : 0,
    input.projectId ?? null,
    max + 1,
    now,
    now
  )
  return getConnection(id)!
}

export function updateConnection(id: string, patch: UpdateConnectionInput): ConnectionRecord {
  const d = getDb()
  const sets: string[] = []
  const values: unknown[] = []
  const set = (col: string, val: unknown): void => {
    sets.push(`${col} = ?`)
    values.push(val)
  }
  if (patch.name !== undefined) set('name', patch.name)
  if (patch.dbType !== undefined) set('db_type', patch.dbType)
  if (patch.host !== undefined) set('host', patch.host)
  if (patch.port !== undefined) set('port', patch.port)
  if (patch.database !== undefined) set('database_name', patch.database)
  if (patch.user !== undefined) set('db_user', patch.user)
  if (patch.encryptedPassword !== undefined) set('encrypted_password', patch.encryptedPassword)
  if (patch.sslEnabled !== undefined) set('ssl_enabled', patch.sslEnabled ? 1 : 0)
  if (patch.sslConfig !== undefined) set('ssl_config', JSON.stringify(patch.sslConfig))
  if (patch.schemas !== undefined) set('schemas', JSON.stringify(patch.schemas))
  if (patch.autoCheckDisabled !== undefined) set('auto_check_disabled', patch.autoCheckDisabled ? 1 : 0)
  // 소속 옮기기 — null 이 "공용으로 되돌리기" 라서 undefined 와 갈라야 한다.
  if (patch.projectId !== undefined) set('project_id', patch.projectId)

  if (sets.length > 0) {
    set('updated_at', new Date().toISOString())
    values.push(id)
    d.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]))
  }
  return getConnection(id)!
}

const LIBRARY_TABLES = ['query_folders', 'saved_queries', 'collection_folders', 'collections']

export function deleteConnection(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    // 이 연결만의 라이브러리(저장쿼리·컬렉션)는 **물린 설계로 넘긴다** — 설계가 딱 하나일 때만.
    // 예전엔 아무 처리도 안 해서 행이 남되 가리킬 연결이 없어 영영 못 찾았다(2026-08-04 사용자
    // 지적: "connection 객체를 잃어버리면 모아 두었던 데이터가 날아간다"). 설계로 넘기면
    // 형제 연결에서 그대로 이어 쓴다.
    const bound = d
      .prepare('SELECT DISTINCT design_id FROM environments WHERE connection_id = ?')
      .all(id) as unknown as { design_id: string }[]
    for (const t of LIBRARY_TABLES) {
      if (bound.length === 1) {
        d.prepare(`UPDATE ${t} SET design_id = ?, connection_id = '' WHERE design_id = '' AND connection_id = ?`)
          .run(bound[0].design_id, id)
      } else {
        // 넘길 설계가 없거나(연결만 쓰던 사람) 여럿이라 못 고를 때 — 남겨 봐야 아무 화면에서도
        // 못 여는 행이라 지운다. 설계 소속으로 이미 옮겨 간 것은 `design_id` 가 차 있어 안 걸린다.
        d.prepare(`DELETE FROM ${t} WHERE design_id = '' AND connection_id = ?`).run(id)
      }
    }
    // 연결에 매인 바인딩(Environment)도 함께 정리.
    d.prepare('DELETE FROM environments WHERE connection_id = ?').run(id)
    d.prepare('DELETE FROM connections WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function reorderConnections(orderedIds: string[]): void {
  const d = getDb()
  const stmt = d.prepare('UPDATE connections SET sort_order = ? WHERE id = ?')
  d.exec('BEGIN')
  try {
    orderedIds.forEach((id, i) => stmt.run(i + 1, id))
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/**
 * 연결을 그룹으로(또는 미분류로) 이동 + 전체 표시 순서를 한 트랜잭션으로 반영.
 * orderedIds 는 화면이 계산한 "모든 연결"의 새 전역 순서(그룹 내 순서는 이 전역 순서에서 파생).
 */
export function moveConnection(id: string, groupId: string | null, orderedIds: string[]): ConnectionRecord {
  const d = getDb()
  if (!getConnection(id)) throw new Error(`연결을 찾을 수 없습니다: ${id}`)
  if (groupId !== null && !getConnectionGroup(groupId)) throw new Error(`그룹을 찾을 수 없습니다: ${groupId}`)
  const stmt = d.prepare('UPDATE connections SET sort_order = ? WHERE id = ?')
  d.exec('BEGIN')
  try {
    d.prepare('UPDATE connections SET group_id = ?, updated_at = ? WHERE id = ?').run(
      groupId,
      new Date().toISOString(),
      id
    )
    orderedIds.forEach((cid, i) => stmt.run(i + 1, cid))
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return getConnection(id)!
}

// ── Connection 그룹 CRUD ──────────────────────────────────────────────

function toGroupRecord(r: GroupRow): ConnectionGroupRecord {
  return { id: r.id, name: r.name, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at }
}

export function listConnectionGroups(): ConnectionGroupRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM connection_groups ORDER BY sort_order ASC, created_at ASC')
    .all() as unknown as GroupRow[]
  return rows.map(toGroupRecord)
}

export function getConnectionGroup(id: string): ConnectionGroupRecord | null {
  const row = getDb().prepare('SELECT * FROM connection_groups WHERE id = ?').get(id) as
    | GroupRow
    | undefined
  return row ? toGroupRecord(row) : null
}

export function createConnectionGroup(name: string): ConnectionGroupRecord {
  const d = getDb()
  const id = `cgrp_${randomUUID()}`
  const now = new Date().toISOString()
  const { max } = d
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM connection_groups')
    .get() as unknown as { max: number }
  d.prepare(
    'INSERT INTO connection_groups (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, max + 1, now, now)
  return getConnectionGroup(id)!
}

export function renameConnectionGroup(id: string, name: string): ConnectionGroupRecord {
  const d = getDb()
  if (!getConnectionGroup(id)) throw new Error(`그룹을 찾을 수 없습니다: ${id}`)
  d.prepare('UPDATE connection_groups SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    new Date().toISOString(),
    id
  )
  return getConnectionGroup(id)!
}

/** 그룹 표시 순서를 orderedIds 대로 재부여(한 트랜잭션). */
export function reorderConnectionGroups(orderedIds: string[]): void {
  const d = getDb()
  const stmt = d.prepare('UPDATE connection_groups SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  d.exec('BEGIN')
  try {
    orderedIds.forEach((id, i) => stmt.run(i + 1, now, id))
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

/** 그룹 삭제 — 소속 연결은 지우지 않고 미분류(group_id NULL)로 되돌린다. */
export function deleteConnectionGroup(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('UPDATE connections SET group_id = NULL WHERE group_id = ?').run(id)
    d.prepare('DELETE FROM connection_groups WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
