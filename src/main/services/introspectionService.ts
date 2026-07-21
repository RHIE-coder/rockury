import { decrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import { getConnectionWithPassword } from '../store/connections'
import { introspectMysql } from './introspection/mysql'
import { introspectPg } from './introspection/postgres'
import { introspectSqlite } from './introspection/sqlite'
import type { IntrospectedSchema } from './introspection/types'

/**
 * Introspection 오케스트레이터(§ops-plan Phase 2a) — 환경 설정으로 실 DB 에 접속해
 * 벤더 어댑터를 태우고 IR 을 돌려준다. 접속은 매번 열고 닫는다(조회 전용).
 * 정규화(IR→TableDef)는 렌더러 순수 함수가 담당 — 여기선 원시 IR 만.
 */
export const introspectionService = {
  async run(connectionId: string): Promise<IntrospectedSchema> {
    const env = getConnectionWithPassword(connectionId)
    if (!env) throw new Error(`연결을 찾을 수 없습니다: ${connectionId}`)
    const password = env.encryptedPassword ? decrypt(env.encryptedPassword) : ''

    if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
      const conn = await createMysqlConnection({
        host: env.host,
        port: env.port,
        database: env.database,
        username: env.user,
        password,
        sslEnabled: env.sslEnabled,
        sslConfig: env.sslConfig
      })
      try {
        return await introspectMysql(conn, env.dbType)
      } finally {
        await closeMysqlConnection(conn)
      }
    }

    if (env.dbType === 'postgresql') {
      const client = await createPgConnection({
        host: env.host,
        port: env.port,
        database: env.database,
        username: env.user,
        password,
        sslEnabled: env.sslEnabled,
        sslConfig: env.sslConfig
      })
      try {
        return await introspectPg(client)
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
  }
}
