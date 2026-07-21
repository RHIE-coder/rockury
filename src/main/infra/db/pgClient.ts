import { Client } from 'pg'

/**
 * PostgreSQL 드라이버 클라이언트 — rky-mvp verbatim 이식(§ops-plan Phase 0).
 * pg 는 순수 JS(pg-native 미사용) → 네이티브 빌드 없음.
 */
export interface PgConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  sslEnabled?: boolean
  sslConfig?: Record<string, unknown>
}

export async function createPgConnection(config: PgConnectionConfig): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.sslEnabled ? (config.sslConfig ?? { rejectUnauthorized: false }) : undefined,
    connectionTimeoutMillis: 10_000
  })
  await client.connect()
  return client
}

export async function closePgConnection(client: Client): Promise<void> {
  await client.end()
}
