import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * Environment — 배포 바인딩(§IA). Connection(접속 정보) + Design 소속 + 타깃/적용 버전.
 *
 * rky-mvp `connectionRepository`(better-sqlite3)를 node:sqlite 로 어댑트하고
 * Environment 도메인(design_id/target_version/applied_version)을 얹었다.
 * 비밀번호는 암호문만 저장하고 렌더러 레코드(EnvironmentRecord)에는 노출하지 않는다.
 */
export type EnvDbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'

export interface EnvironmentRecord {
  id: string
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
  appliedVersion: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateEnvironmentInput {
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  encryptedPassword: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
}

export type UpdateEnvironmentInput = Partial<{
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  encryptedPassword: string
  sslEnabled: boolean
  sslConfig: Record<string, unknown>
  targetVersion: string
  appliedVersion: string | null
}>

interface EnvRow {
  id: string
  design_id: string
  name: string
  db_type: string
  host: string
  port: number
  database_name: string
  db_user: string
  encrypted_password: string
  ssl_enabled: number
  ssl_config: string | null
  target_version: string
  applied_version: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function toRecord(row: EnvRow): EnvironmentRecord {
  return {
    id: row.id,
    designId: row.design_id,
    name: row.name,
    dbType: row.db_type as EnvDbType,
    host: row.host,
    port: row.port,
    database: row.database_name,
    user: row.db_user,
    sslEnabled: row.ssl_enabled === 1,
    sslConfig: row.ssl_config ? (JSON.parse(row.ssl_config) as Record<string, unknown>) : undefined,
    targetVersion: row.target_version,
    appliedVersion: row.applied_version,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listEnvironments(designId: string): EnvironmentRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM environments WHERE design_id = ? ORDER BY sort_order ASC, created_at ASC'
    )
    .all(designId) as unknown as EnvRow[]
  return rows.map(toRecord)
}

export function getEnvironment(id: string): EnvironmentRecord | null {
  const row = getDb().prepare('SELECT * FROM environments WHERE id = ?').get(id) as
    | EnvRow
    | undefined
  return row ? toRecord(row) : null
}

/** 내부 서비스용 — 암호문 포함(연결 테스트/실행 직전 복호화에 쓴다). 렌더러 노출 금지. */
export function getEnvironmentWithPassword(
  id: string
): (EnvironmentRecord & { encryptedPassword: string }) | null {
  const row = getDb().prepare('SELECT * FROM environments WHERE id = ?').get(id) as
    | EnvRow
    | undefined
  if (!row) return null
  return { ...toRecord(row), encryptedPassword: row.encrypted_password }
}

export function createEnvironment(input: CreateEnvironmentInput): EnvironmentRecord {
  const d = getDb()
  const id = `env_${randomUUID()}`
  const now = new Date().toISOString()
  const { max } = d
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM environments WHERE design_id = ?')
    .get(input.designId) as unknown as { max: number }

  d.prepare(
    `INSERT INTO environments
       (id, design_id, name, db_type, host, port, database_name, db_user,
        encrypted_password, ssl_enabled, ssl_config, target_version, applied_version,
        sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    input.designId,
    input.name,
    input.dbType,
    input.host,
    input.port,
    input.database,
    input.user,
    input.encryptedPassword,
    input.sslEnabled ? 1 : 0,
    input.sslConfig ? JSON.stringify(input.sslConfig) : null,
    input.targetVersion,
    max + 1,
    now,
    now
  )
  return getEnvironment(id)!
}

export function updateEnvironment(id: string, patch: UpdateEnvironmentInput): EnvironmentRecord {
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
  if (patch.targetVersion !== undefined) set('target_version', patch.targetVersion)
  if (patch.appliedVersion !== undefined) set('applied_version', patch.appliedVersion)

  if (sets.length > 0) {
    set('updated_at', new Date().toISOString())
    values.push(id)
    d.prepare(`UPDATE environments SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]))
  }
  return getEnvironment(id)!
}

export function deleteEnvironment(id: string): void {
  getDb().prepare('DELETE FROM environments WHERE id = ?').run(id)
}

/** 드래그 재정렬 — id 순서대로 sort_order 를 다시 매긴다(설계 내 순서). */
export function reorderEnvironments(orderedIds: string[]): void {
  const d = getDb()
  const stmt = d.prepare('UPDATE environments SET sort_order = ? WHERE id = ?')
  d.exec('BEGIN')
  try {
    orderedIds.forEach((id, i) => stmt.run(i + 1, id))
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
