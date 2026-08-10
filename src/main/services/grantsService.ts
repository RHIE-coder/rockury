import { decrypt } from '../infra/crypto'
import { closeMysqlConnection, createMysqlConnection } from '../infra/db/mysqlClient'
import { closePgConnection, createPgConnection } from '../infra/db/pgClient'
import { getConnectionWithPassword, type ConnectionRecord } from '../store/connections'
import { introspectMysqlGrants } from './grants/mysql'
import { introspectPgGrants } from './grants/pg'
import { buildStatements, type GrantChange, type StatementPlan } from './grants/statements'
import type { GrantsIR } from './grants/types'

/**
 * 권한(Grant) 오케스트레이터(§db-remote.grants) — 연결 설정으로 실 DB 에 접속해
 * 벤더 어댑터를 태우고 IR 을 돌려준다. 접속은 매번 열고 닫는다(introspection 과 동일).
 *
 * 문장 생성은 `grants/statements` **한 곳**이다 — 미리보기(plan)와 실행(apply)이 같은
 * 함수를 부르므로 보인 문장과 실행 문장이 어긋날 수 없다(apply AC-4).
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

export interface ApplyResult {
  /** 실행된 문장(순서대로). 실패한 문장이 마지막이고, 그 뒤는 실행되지 않았다. */
  executed: { sql: string; ok: boolean; error?: string }[]
  /** 생성에서 빠진 문장 — 말없이 빼지 않는다(apply AC-3a). */
  excluded: StatementPlan['excluded']
}

export const grantsService = {
  async run(connectionId: string): Promise<GrantsIR> {
    const { env, password } = load(connectionId)

    if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
      const conn = await createMysqlConnection(netConfig(env, password))
      try {
        return await introspectMysqlGrants(conn, env.dbType)
      } finally {
        await closeMysqlConnection(conn)
      }
    }
    if (env.dbType === 'postgresql') {
      const client = await createPgConnection(netConfig(env, password))
      try {
        return await introspectPgGrants(client)
      } finally {
        await closePgConnection(client)
      }
    }
    // SQLite — 권한 개념이 없다(vendor AC-4). 화면이 탭을 비활성으로 그리므로 여기 올 일이
    // 없지만, 왔다면 조용한 빈 결과 대신 명시적 오류다(빈 결과는 "없다"로 오독된다).
    throw new Error(`권한을 지원하지 않는 DB 종류: ${env.dbType}`)
  },

  /** 미리보기 — 순수 생성만. currentAccount 는 렌더러가 IR 에서 집어 보낸다(isCurrent). */
  plan(
    connectionId: string,
    changes: GrantChange[],
    opts: { includeRevoke: boolean; currentAccount: string }
  ): StatementPlan {
    const { env } = load(connectionId)
    if (env.dbType === 'sqlite') throw new Error('권한을 지원하지 않는 DB 종류: sqlite')
    return buildStatements(env.dbType, changes, opts)
  },

  /**
   * 실행 — 같은 diff 로 문장을 **다시 생성**해(같은 생성기 = 같은 문장) 순서대로 실행한다.
   * 자기 회수 차단의 currentAccount 는 여기서 **실 접속으로 새로 잰다**(이중 방어, apply AC-3) —
   * 렌더러가 보낸 값을 믿지 않는다.
   */
  async apply(
    connectionId: string,
    changes: GrantChange[],
    opts: { includeRevoke: boolean }
  ): Promise<ApplyResult> {
    const { env, password } = load(connectionId)

    if (env.dbType === 'mysql' || env.dbType === 'mariadb') {
      const conn = await createMysqlConnection(netConfig(env, password))
      try {
        const me = ((await conn.query('SELECT CURRENT_USER() AS me')) as unknown as [{ me: string }[]])[0][0]?.me ?? ''
        const plan = buildStatements(env.dbType, changes, { ...opts, currentAccount: me })
        return await execute(plan, (sql) => conn.query(sql).then(() => undefined))
      } finally {
        await closeMysqlConnection(conn)
      }
    }
    if (env.dbType === 'postgresql') {
      const client = await createPgConnection(netConfig(env, password))
      try {
        const me = (await client.query('SELECT current_user AS me')).rows[0]?.me ?? ''
        const plan = buildStatements('postgresql', changes, { ...opts, currentAccount: me })
        return await execute(plan, (sql) => client.query(sql).then(() => undefined))
      } finally {
        await closePgConnection(client)
      }
    }
    throw new Error(`권한을 지원하지 않는 DB 종류: ${env.dbType}`)
  }
}

/**
 * 순서대로 실행, 실패에서 멈춘다 — GRANT/REVOKE 는 자동 커밋이라 롤백이 없다.
 * 어디까지 실행됐는지를 숨기지 않는 것이 안전장치다(apply AC-1).
 */
async function execute(plan: StatementPlan, runOne: (sql: string) => Promise<void>): Promise<ApplyResult> {
  const executed: ApplyResult['executed'] = []
  for (const st of plan.statements) {
    try {
      await runOne(st.sql)
      executed.push({ sql: st.sql, ok: true })
    } catch (e) {
      executed.push({ sql: st.sql, ok: false, error: e instanceof Error ? e.message : String(e) })
      break
    }
  }
  return { executed, excluded: plan.excluded }
}
