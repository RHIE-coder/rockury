import { randomUUID } from 'node:crypto'
import type { Connection as MysqlConnection } from 'mysql2/promise'
import type { Client as PgClient } from 'pg'
import type { DatabaseSync } from 'node:sqlite'
import { decrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { closeSqliteConnection, createSqliteConnection } from '../infra/db/sqliteClient'
import { getEnvironmentWithPassword } from '../store/environments'
import { splitStatements } from './query/splitStatements'

/**
 * 쿼리 실행 서비스(§ops-plan Phase 2c) — 활성 환경의 실 DB 에 SQL 을 실행한다.
 *
 * 두 경로:
 *  - `run`   : 읽기/DDL 등 즉시 실행(새 연결 open→close). 멀티문 지원 + 타임아웃.
 *  - tx 게이트: DML 파괴 방지 — `txBegin`→`txExec`(영향행수 미리보기)→`txCommit`/`txRollback`.
 *    트랜잭션 세션은 연결을 열어둔 채 main 이 보관(txId 키). 오래된 세션은 open 시 자동 롤백 스윕.
 *    (MySQL 은 DDL 암묵 커밋이라 게이트는 DML 한정 — §IA.)
 */
export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
}
export interface TxBeginResult {
  txId: string
  dbType: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const SESSION_MAX_AGE_MS = 5 * 60_000

type Handle =
  | { kind: 'mysql'; conn: MysqlConnection }
  | { kind: 'pg'; client: PgClient }
  | { kind: 'sqlite'; db: DatabaseSync }

interface TxSession {
  handle: Handle
  dbType: string
  createdAt: number
}
const sessions = new Map<string, TxSession>()

export const queryService = {
  async run(envId: string, sql: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<QueryResult> {
    const statements = splitStatements(sql)
    if (statements.length === 0) throw new Error('실행할 SQL 이 없습니다.')

    const start = Date.now()
    const handle = await open(envId)
    try {
      const result = await execScript(handle, statements, timeoutMs)
      return { ...result, executionTimeMs: Date.now() - start }
    } finally {
      await close(handle)
    }
  },

  async txBegin(envId: string): Promise<TxBeginResult> {
    await sweepStale()
    const handle = await open(envId)
    try {
      await begin(handle)
    } catch (e) {
      await close(handle)
      throw e
    }
    const txId = `tx_${randomUUID()}`
    sessions.set(txId, { handle, dbType: handle.kind, createdAt: Date.now() })
    return { txId, dbType: handle.kind }
  },

  /** 열린 트랜잭션에서 실행하고 영향 행수를 돌려준다. 실패 시 세션을 롤백·정리하고 던진다. */
  async txExec(txId: string, sql: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<QueryResult> {
    const session = sessions.get(txId)
    if (!session) throw new Error('트랜잭션 세션을 찾을 수 없습니다(만료되었을 수 있음).')
    const statements = splitStatements(sql)
    if (statements.length === 0) throw new Error('실행할 SQL 이 없습니다.')

    const start = Date.now()
    try {
      const result = await execScript(session.handle, statements, timeoutMs)
      return { ...result, executionTimeMs: Date.now() - start }
    } catch (e) {
      await safeRollback(txId)
      throw e
    }
  },

  /** 파라미터 바인드 즉시 실행(새 연결). 데이터 편집의 개별 문에 쓰인다. */
  async runParams(
    envId: string,
    sql: string,
    params: unknown[],
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<QueryResult> {
    const start = Date.now()
    const handle = await open(envId)
    try {
      const result = await execOne(handle, sql, timeoutMs, params)
      return { ...result, executionTimeMs: Date.now() - start }
    } finally {
      await close(handle)
    }
  },

  /** 열린 트랜잭션에서 파라미터 바인드로 실행(데이터 편집 커밋 경로). 실패 시 세션 롤백·정리. */
  async txExecParams(
    txId: string,
    sql: string,
    params: unknown[],
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<QueryResult> {
    const session = sessions.get(txId)
    if (!session) throw new Error('트랜잭션 세션을 찾을 수 없습니다(만료되었을 수 있음).')
    const start = Date.now()
    try {
      const result = await execOne(session.handle, sql, timeoutMs, params)
      return { ...result, executionTimeMs: Date.now() - start }
    } catch (e) {
      await safeRollback(txId)
      throw e
    }
  },

  async txCommit(txId: string): Promise<void> {
    const session = sessions.get(txId)
    if (!session) throw new Error('트랜잭션 세션을 찾을 수 없습니다.')
    try {
      await commit(session.handle)
    } finally {
      await close(session.handle)
      sessions.delete(txId)
    }
  },

  async txRollback(txId: string): Promise<void> {
    await safeRollback(txId)
  }
}

async function safeRollback(txId: string): Promise<void> {
  const session = sessions.get(txId)
  if (!session) return
  try {
    await rollback(session.handle)
  } finally {
    await close(session.handle)
    sessions.delete(txId)
  }
}

/** open 시점에 오래 매달린 트랜잭션을 롤백·정리(연결 누수 방지). */
async function sweepStale(): Promise<void> {
  const now = Date.now()
  for (const [txId, s] of [...sessions.entries()]) {
    if (now - s.createdAt > SESSION_MAX_AGE_MS) await safeRollback(txId)
  }
}

async function open(envId: string): Promise<Handle> {
  const env = getEnvironmentWithPassword(envId)
  if (!env) throw new Error(`환경을 찾을 수 없습니다: ${envId}`)
  const password = env.encryptedPassword ? decrypt(env.encryptedPassword) : ''

  if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
    const conn = await createMysqlConnection({
      host: env.host, port: env.port, database: env.database,
      username: env.user, password, sslEnabled: env.sslEnabled, sslConfig: env.sslConfig
    })
    return { kind: 'mysql', conn }
  }
  if (env.dbType === 'postgresql') {
    const client = await createPgConnection({
      host: env.host, port: env.port, database: env.database,
      username: env.user, password, sslEnabled: env.sslEnabled, sslConfig: env.sslConfig
    })
    return { kind: 'pg', client }
  }
  if (env.dbType === 'sqlite') {
    return { kind: 'sqlite', db: createSqliteConnection({ database: env.database }) }
  }
  throw new Error(`지원하지 않는 DB 종류: ${env.dbType}`)
}

async function close(h: Handle): Promise<void> {
  if (h.kind === 'mysql') await closeMysqlConnection(h.conn).catch(() => {})
  else if (h.kind === 'pg') await closePgConnection(h.client).catch(() => {})
  else closeSqliteConnection(h.db)
}

const begin = (h: Handle): Promise<void> => exec(h, h.kind === 'mysql' ? 'START TRANSACTION' : 'BEGIN')
const commit = (h: Handle): Promise<void> => exec(h, 'COMMIT')
const rollback = (h: Handle): Promise<void> => exec(h, 'ROLLBACK')

async function exec(h: Handle, sql: string): Promise<void> {
  if (h.kind === 'mysql') await h.conn.query(sql)
  else if (h.kind === 'pg') await h.client.query(sql)
  else h.db.exec(sql)
}

/** 여러 문장을 순차 실행 — 마지막 결과를 반환, DML 영향행수는 합산. */
async function execScript(h: Handle, statements: string[], timeoutMs: number): Promise<QueryResult> {
  let last: QueryResult = { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 }
  let totalAffected = 0
  let sawAffected = false

  for (const stmt of statements) {
    last = await execOne(h, stmt, timeoutMs)
    if (typeof last.affectedRows === 'number') {
      totalAffected += last.affectedRows
      sawAffected = true
    }
  }
  if (statements.length > 1 && sawAffected) return { ...last, affectedRows: totalAffected }
  return last
}

async function execOne(
  h: Handle,
  sql: string,
  timeoutMs: number,
  params?: unknown[]
): Promise<QueryResult> {
  if (h.kind === 'mysql') {
    const [results, fields] = await withTimeout(
      h.conn.query({ sql, values: params, timeout: timeoutMs }),
      timeoutMs
    )
    if (Array.isArray(results)) {
      const rows = results as Record<string, unknown>[]
      const columns = fields
        ? (fields as Array<{ name: string }>).map((f) => f.name)
        : rows.length > 0
          ? Object.keys(rows[0])
          : []
      return { columns, rows, rowCount: rows.length, executionTimeMs: 0 }
    }
    const info = results as { affectedRows?: number }
    return { columns: [], rows: [], rowCount: 0, affectedRows: info.affectedRows ?? 0, executionTimeMs: 0 }
  }

  if (h.kind === 'pg') {
    const r = await withTimeout(
      params ? h.client.query(sql, params) : h.client.query(sql),
      timeoutMs
    )
    const rows = (r.rows ?? []) as Record<string, unknown>[]
    const columns = r.fields ? r.fields.map((f) => f.name) : rows.length ? Object.keys(rows[0]) : []
    const isRowSet = r.command === 'SELECT' || rows.length > 0
    return {
      columns,
      rows,
      rowCount: rows.length,
      affectedRows: isRowSet ? undefined : (r.rowCount ?? 0),
      executionTimeMs: 0
    }
  }

  // sqlite (동기 — 타임아웃 미적용)
  const bind = params ? coerceSqliteParams(params) : []
  const upper = sql.trimStart().slice(0, 8).toUpperCase()
  const isRead = /^(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)/.test(upper)
  if (isRead) {
    const rows = h.db.prepare(sql).all(...bind) as Record<string, unknown>[]
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      executionTimeMs: 0
    }
  }
  const info = h.db.prepare(sql).run(...bind)
  return { columns: [], rows: [], rowCount: 0, affectedRows: Number(info.changes), executionTimeMs: 0 }
}

/** node:sqlite 바인드 허용 타입으로 강제(boolean→0/1, undefined→null). */
function coerceSqliteParams(params: unknown[]): (string | number | bigint | null | Uint8Array)[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    if (typeof p === 'number' || typeof p === 'bigint' || typeof p === 'string') return p
    if (p instanceof Uint8Array) return p
    return String(p)
  })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`쿼리 시간 초과(${ms}ms)`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
