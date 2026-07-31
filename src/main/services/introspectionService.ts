import { decrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import { getConnectionWithPassword, type ConnectionRecord } from '../store/connections'
import { introspectMysql, listMysqlSchemas } from './introspection/mysql'
import { introspectPg, listPgCatalogs, listPgSchemas } from './introspection/postgres'
import { introspectSqlite } from './introspection/sqlite'
import type { IntrospectedSchema } from './introspection/types'

/**
 * Introspection 오케스트레이터(§ops-plan Phase 2a · §db-remote.scope) — 연결 설정으로 실 DB 에
 * 접속해 벤더 어댑터를 태우고 IR 을 돌려준다. 접속은 매번 열고 닫는다(조회 전용).
 * 정규화(IR→TableDef)는 렌더러 순수 함수가 담당 — 여기선 원시 IR 만.
 *
 * 범위(어느 스키마를 읽나)는 **연결에 저장된 것**을 쓰되, 부르는 쪽이 덮어쓸 수 있다
 * (범위를 막 바꿨을 때 저장이 끝나기를 기다리지 않고 바로 읽기 위해).
 */

type WithPassword = ConnectionRecord & { encryptedPassword: string }

function load(connectionId: string): { env: WithPassword; password: string } {
  const env = getConnectionWithPassword(connectionId)
  if (!env) throw new Error(`연결을 찾을 수 없습니다: ${connectionId}`)
  return { env, password: env.encryptedPassword ? decrypt(env.encryptedPassword) : '' }
}

const netConfig = (env: WithPassword, password: string) => ({
  host: env.host,
  port: env.port,
  database: env.database,
  username: env.user,
  password,
  sslEnabled: env.sslEnabled,
  sslConfig: env.sslConfig
})

export const introspectionService = {
  async run(connectionId: string, schemas?: string[]): Promise<IntrospectedSchema> {
    const { env, password } = load(connectionId)
    const scope = schemas ?? env.schemas ?? []

    if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
      const conn = await createMysqlConnection(netConfig(env, password))
      try {
        return await introspectMysql(conn, env.dbType, scope)
      } finally {
        await closeMysqlConnection(conn)
      }
    }

    if (env.dbType === 'postgresql') {
      const client = await createPgConnection(netConfig(env, password))
      try {
        return await introspectPg(client, scope)
      } finally {
        await closePgConnection(client)
      }
    }

    if (env.dbType === 'sqlite') {
      const db = createSqliteConnection({ database: env.database })
      try {
        return introspectSqlite(db)
      } finally {
        closeSqliteConnection(db)
      }
    }

    throw new Error(`지원하지 않는 DB 종류: ${env.dbType}`)
  },

  /**
   * 이 연결에서 **고를 수 있는** 스키마 목록. 시스템 스키마는 뺀다.
   * SQLite 는 `main` 하나뿐이라 고를 것이 없다(빈 목록 대신 그 하나를 돌려준다 — 화면이
   * "못 읽었다"와 "하나뿐이다"를 가르지 못하면 안 된다).
   */
  async schemas(connectionId: string): Promise<string[]> {
    const { env, password } = load(connectionId)

    if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
      const conn = await createMysqlConnection(netConfig(env, password))
      try {
        return await listMysqlSchemas(conn)
      } finally {
        await closeMysqlConnection(conn)
      }
    }

    if (env.dbType === 'postgresql') {
      const client = await createPgConnection(netConfig(env, password))
      try {
        return await listPgSchemas(client)
      } finally {
        await closePgConnection(client)
      }
    }

    return ['main']
  },

  /**
   * 이 서버의 카탈로그(database) 목록 — **PostgreSQL 만** 의미가 있다.
   * MySQL 은 카탈로그와 스키마가 같은 말이라 `schemas()` 가 이미 그 목록이고,
   * SQLite 는 파일 하나가 곧 카탈로그다. 둘 다 빈 목록으로 답해 화면이 층을 안 그리게 한다.
   */
  async catalogs(connectionId: string): Promise<string[]> {
    const { env, password } = load(connectionId)
    if (env.dbType !== 'postgresql') return []

    const client = await createPgConnection(netConfig(env, password))
    try {
      return await listPgCatalogs(client)
    } finally {
      await closePgConnection(client)
    }
  }
}
