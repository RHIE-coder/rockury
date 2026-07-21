import { decrypt, encrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import {
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionWithPassword,
  listConnections,
  reorderConnections,
  updateConnection,
  type ConnectionRecord,
  type DbType
} from '../store/connections'

/**
 * Connection 서비스(§IA · 결정 B) — 원시 접속의 CRUD + 연결 테스트.
 * 비밀번호 암복호화는 여기서만. 설계와 무관 — Console 이 이걸로 실 DB 를 조회한다.
 */
export interface ConnectionFormData {
  name: string
  dbType: DbType
  host: string
  port: number
  database: string
  user: string
  password: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
}

export interface TestConnectionResult {
  success: boolean
  message: string
  latencyMs?: number
  serverVersion?: string
}

export const connectionService = {
  list(): ConnectionRecord[] {
    return listConnections()
  },

  create(form: ConnectionFormData): ConnectionRecord {
    return createConnection({
      name: form.name,
      dbType: form.dbType,
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      encryptedPassword: form.password ? encrypt(form.password) : '',
      sslEnabled: form.sslEnabled,
      sslConfig: form.sslConfig
    })
  },

  update(id: string, form: Partial<ConnectionFormData>): ConnectionRecord {
    if (!getConnection(id)) throw new Error(`연결을 찾을 수 없습니다: ${id}`)
    return updateConnection(id, {
      name: form.name,
      dbType: form.dbType,
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      encryptedPassword: form.password ? encrypt(form.password) : undefined,
      sslEnabled: form.sslEnabled,
      sslConfig: form.sslConfig
    })
  },

  delete(id: string): void {
    deleteConnection(id)
  },

  reorder(orderedIds: string[]): void {
    reorderConnections(orderedIds)
  },

  async testConnection(form: ConnectionFormData): Promise<TestConnectionResult> {
    return runTest(form)
  },

  async testConnectionById(id: string): Promise<TestConnectionResult> {
    const row = getConnectionWithPassword(id)
    if (!row) throw new Error(`연결을 찾을 수 없습니다: ${id}`)
    return runTest({
      name: row.name,
      dbType: row.dbType,
      host: row.host,
      port: row.port,
      database: row.database,
      user: row.user,
      password: row.encryptedPassword ? decrypt(row.encryptedPassword) : '',
      sslEnabled: row.sslEnabled,
      sslConfig: row.sslConfig
    })
  }
}

/** 벤더별 접속 → 서버 버전 조회. 실패는 메시지로 감싼다(예외 던지지 않음). */
async function runTest(form: ConnectionFormData): Promise<TestConnectionResult> {
  const start = Date.now()
  try {
    if (form.dbType === 'mysql' || form.dbType === 'mariadb') {
      const conn = await createMysqlConnection({
        host: form.host,
        port: form.port,
        database: form.database,
        username: form.user,
        password: form.password,
        sslEnabled: form.sslEnabled,
        sslConfig: form.sslConfig
      })
      const [rows] = await conn.query('SELECT VERSION() AS version')
      const version = (rows as Array<{ version: string }>)[0]?.version ?? 'unknown'
      await closeMysqlConnection(conn)
      return { success: true, message: '연결 성공', latencyMs: Date.now() - start, serverVersion: version }
    }

    if (form.dbType === 'postgresql') {
      const client = await createPgConnection({
        host: form.host,
        port: form.port,
        database: form.database,
        username: form.user,
        password: form.password,
        sslEnabled: form.sslEnabled,
        sslConfig: form.sslConfig
      })
      const result = await client.query<{ version: string }>('SELECT version()')
      const version = result.rows[0]?.version ?? 'unknown'
      await closePgConnection(client)
      return { success: true, message: '연결 성공', latencyMs: Date.now() - start, serverVersion: version }
    }

    if (form.dbType === 'sqlite') {
      const db = createSqliteConnection({ database: form.database })
      const row = db.prepare('SELECT sqlite_version() AS version').get() as
        | { version: string }
        | undefined
      closeSqliteConnection(db)
      return {
        success: true,
        message: '연결 성공',
        latencyMs: Date.now() - start,
        serverVersion: `SQLite ${row?.version ?? 'unknown'}`
      }
    }

    return { success: false, message: `지원하지 않는 DB 종류: ${form.dbType}` }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start
    }
  }
}
