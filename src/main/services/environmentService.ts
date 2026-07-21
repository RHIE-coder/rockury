import { decrypt, encrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  getEnvironmentWithPassword,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment,
  type EnvDbType,
  type EnvironmentRecord
} from '../store/environments'

/**
 * 운영부 Environment 서비스 — repository ↔ 드라이버(infra) 사이의 도메인 계층(§ops-plan Phase 1).
 * 비밀번호 암복호화는 여기서만 일어난다(repository 는 암호문만, 렌더러는 평문만 잠깐 다룸).
 */

/** 렌더러가 보내는 환경 폼 — 평문 password 포함. */
export interface EnvironmentFormData {
  designId: string
  name: string
  dbType: EnvDbType
  host: string
  port: number
  database: string
  user: string
  password: string
  sslEnabled: boolean
  sslConfig?: Record<string, unknown>
  targetVersion: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  latencyMs?: number
  serverVersion?: string
}

export const environmentService = {
  list(designId: string): EnvironmentRecord[] {
    return listEnvironments(designId)
  },

  create(form: EnvironmentFormData): EnvironmentRecord {
    return createEnvironment({
      designId: form.designId,
      name: form.name,
      dbType: form.dbType,
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      encryptedPassword: form.password ? encrypt(form.password) : '',
      sslEnabled: form.sslEnabled,
      sslConfig: form.sslConfig,
      targetVersion: form.targetVersion
    })
  },

  update(id: string, form: Partial<EnvironmentFormData>): EnvironmentRecord {
    if (!getEnvironment(id)) throw new Error(`환경을 찾을 수 없습니다: ${id}`)
    return updateEnvironment(id, {
      name: form.name,
      dbType: form.dbType,
      host: form.host,
      port: form.port,
      database: form.database,
      user: form.user,
      // 빈 문자열이면 비밀번호 미변경(기존 유지). 값이 있을 때만 재암호화.
      encryptedPassword: form.password ? encrypt(form.password) : undefined,
      sslEnabled: form.sslEnabled,
      sslConfig: form.sslConfig,
      targetVersion: form.targetVersion
    })
  },

  delete(id: string): void {
    deleteEnvironment(id)
  },

  /** 반영 성공 시 적용 버전 갱신(§ops-plan Phase 3 — 지상 진실은 로컬 DB 기록). */
  setApplied(id: string, version: string): EnvironmentRecord {
    if (!getEnvironment(id)) throw new Error(`환경을 찾을 수 없습니다: ${id}`)
    return updateEnvironment(id, { appliedVersion: version })
  },

  reorder(orderedIds: string[]): void {
    reorderEnvironments(orderedIds)
  },

  /** 폼 값(평문 비밀번호 포함)으로 연결 테스트 — 다이얼로그의 "연결 테스트" 버튼. */
  async testConnection(form: EnvironmentFormData): Promise<TestConnectionResult> {
    return runTest(form)
  },

  /** 저장된 환경으로 연결 테스트 — 카드의 "테스트" 버튼(암호문 복호화). */
  async testConnectionById(id: string): Promise<TestConnectionResult> {
    const row = getEnvironmentWithPassword(id)
    if (!row) throw new Error(`환경을 찾을 수 없습니다: ${id}`)
    return runTest({
      designId: row.designId,
      name: row.name,
      dbType: row.dbType,
      host: row.host,
      port: row.port,
      database: row.database,
      user: row.user,
      password: row.encryptedPassword ? decrypt(row.encryptedPassword) : '',
      sslEnabled: row.sslEnabled,
      sslConfig: row.sslConfig,
      targetVersion: row.targetVersion
    })
  }
}

/** 벤더별 접속 → 서버 버전 조회. 실패는 메시지로 감싼다(예외 던지지 않음). */
async function runTest(form: EnvironmentFormData): Promise<TestConnectionResult> {
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
