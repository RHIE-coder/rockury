import mysql from 'mysql2/promise'

/**
 * MySQL/MariaDB 드라이버 클라이언트 — rky-mvp verbatim 이식(§ops-plan Phase 0).
 * mysql2 는 순수 JS(네이티브 없음) → electron-rebuild 불필요.
 */
export interface MysqlConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  sslEnabled?: boolean
  sslConfig?: Record<string, unknown>
}

export async function createMysqlConnection(
  config: MysqlConnectionConfig
): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.sslEnabled ? (config.sslConfig ?? {}) : undefined,
    connectTimeout: 10_000
  })
}

export async function closeMysqlConnection(conn: mysql.Connection): Promise<void> {
  await conn.end()
}
