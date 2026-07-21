import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * Connection — 원시 접속 정보(엔드포인트/자격증명)의 1급 엔티티(§IA · 결정 B).
 *
 * 설계와 무관하게 존재한다. Console(Object/Data/Query = 모니터링/조회)는 이것만으로 동작한다.
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
  sort_order: number
  created_at: string
  updated_at: string
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
        ssl_enabled, ssl_config, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  if (sets.length > 0) {
    set('updated_at', new Date().toISOString())
    values.push(id)
    d.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]))
  }
  return getConnection(id)!
}

export function deleteConnection(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
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
