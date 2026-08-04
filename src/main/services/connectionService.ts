import { decrypt, encrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import {
  createConnection,
  createConnectionGroup,
  deleteConnection,
  deleteConnectionGroup,
  getConnection,
  getConnectionWithPassword,
  listConnectionGroups,
  listConnections,
  moveConnection,
  renameConnectionGroup,
  reorderConnectionGroups,
  reorderConnections,
  updateConnection,
  type ConnectionGroupRecord,
  type ConnectionRecord,
  type DbType
} from '../store/connections'

/**
 * Connection 서비스(§IA · 결정 B) — 원시 접속의 CRUD + 연결 테스트.
 * 비밀번호 암복호화는 여기서만. 설계와 무관 — Remote 가 이걸로 실 DB 를 조회한다.
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
  /** 범위 — 이 연결에서 보고 있는 스키마 목록. 빈 배열이면 기본 스키마 하나(§db-remote.scope). */
  schemas?: string[]
  autoCheckDisabled?: boolean
  /** 속한 프로젝트. null·미지정이면 공용(어느 프로젝트에서나 보이는 접속). */
  projectId?: string | null
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
      sslConfig: form.sslConfig,
      schemas: form.schemas,
      autoCheckDisabled: form.autoCheckDisabled,
      projectId: form.projectId
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
      sslConfig: form.sslConfig,
      schemas: form.schemas,
      autoCheckDisabled: form.autoCheckDisabled,
      projectId: form.projectId
    })
  },

  /**
   * 저장된 비밀번호 평문 반환 — 편집 화면에서 눈 아이콘으로 확인하려는 사용자 요청.
   * 로컬 전용 도구라 허용하되, 복호화 평문이 렌더러로 넘어가는 유일한 경로이므로
   * MCP(원격) 노출은 금지(coverage 제외 등재). 없으면 빈 문자열.
   */
  revealPassword(id: string): string {
    const row = getConnectionWithPassword(id)
    if (!row) throw new Error(`연결을 찾을 수 없습니다: ${id}`)
    return row.encryptedPassword ? decrypt(row.encryptedPassword) : ''
  },

  delete(id: string): void {
    deleteConnection(id)
  },

  reorder(orderedIds: string[]): void {
    reorderConnections(orderedIds)
  },

  /** 그룹 이동(그룹/미분류) + 전역 순서 반영 — DnD 드롭 한 번 = 트랜잭션 한 번. */
  move(id: string, groupId: string | null, orderedIds: string[]): ConnectionRecord {
    return moveConnection(id, groupId, orderedIds)
  },

  listGroups(): ConnectionGroupRecord[] {
    return listConnectionGroups()
  },

  createGroup(name: string): ConnectionGroupRecord {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('그룹 이름을 입력하세요.')
    return createConnectionGroup(trimmed)
  },

  renameGroup(id: string, name: string): ConnectionGroupRecord {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('그룹 이름을 입력하세요.')
    return renameConnectionGroup(id, trimmed)
  },

  reorderGroups(orderedIds: string[]): void {
    reorderConnectionGroups(orderedIds)
  },

  deleteGroup(id: string): void {
    deleteConnectionGroup(id)
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
