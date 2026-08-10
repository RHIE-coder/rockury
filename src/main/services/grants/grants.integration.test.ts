import { describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { introspectMysqlGrants } from './mysql'
import { introspectPgGrants } from './pg'
import { buildStatements } from './statements'

/**
 * CASE-remote-079 — 권한 실 DB 왕복(test-db docker). 기본 `npm test` 에서는 skip.
 * 실행: `GRANTS_IT=1 npx vitest run grants.integration` (사전에 `npm run db:up`).
 * 관리자로 IR → GRANT 적용 → 재조회 반영 → REVOKE 반영 → 원복. 미리보기 문장과 실행이
 * 같은 생성기라 이 테스트가 곧 "보인 문장 = 실행 문장"의 실물 증거다.
 */
const IT = !!process.env.GRANTS_IT

describe.skipIf(!IT)('grants 통합(test-db)', () => {
  it('mysql: 관리자 IR → GRANT/REVOKE 왕복 · 제한 계정은 자기 것만 + 경고', async () => {
    const admin = await mysql.createConnection({ host: 'localhost', port: 13306, user: 'root', password: 'root' })
    try {
      await admin.query("DROP USER IF EXISTS 'grants_probe'@'%'")
      await admin.query("CREATE USER 'grants_probe'@'%' IDENTIFIED BY 'probe'")
      await admin.query("GRANT SELECT ON `testdb`.`users` TO 'grants_probe'@'%'")

      // 관리자 — 전 계정 + 프로브 계정의 권한이 보인다
      const ir = await introspectMysqlGrants(admin, 'mysql')
      expect(ir.warnings).toEqual([])
      expect(ir.accounts.some((a) => a.account === 'grants_probe@%')).toBe(true)
      const before = ir.grants.filter((g) => g.account === 'grants_probe@%')
      expect(before).toEqual([
        { account: 'grants_probe@%', privilege: 'SELECT', layer: 'table', db: 'testdb', table: 'users' }
      ])

      // GRANT 적용(모자람: INSERT) → 재조회 반영
      const grantPlan = buildStatements(
        'mysql',
        [{ account: 'grants_probe@%', db: 'testdb', table: 'users', privilege: 'INSERT', kind: 'missing' }],
        { includeRevoke: false, currentAccount: 'root@%' }
      )
      expect(grantPlan.statements).toHaveLength(1)
      for (const st of grantPlan.statements) await admin.query(st.sql)
      const afterGrant = await introspectMysqlGrants(admin, 'mysql')
      expect(
        afterGrant.grants.some(
          (g) => g.account === 'grants_probe@%' && g.privilege === 'INSERT' && g.table === 'users'
        )
      ).toBe(true)

      // REVOKE(넘침 회수, 옵션 켬) → 재조회에서 사라짐
      const revokePlan = buildStatements(
        'mysql',
        [{ account: 'grants_probe@%', db: 'testdb', table: 'users', privilege: 'INSERT', kind: 'excess', layer: 'table' }],
        { includeRevoke: true, currentAccount: 'root@%' }
      )
      for (const st of revokePlan.statements) await admin.query(st.sql)
      const afterRevoke = await introspectMysqlGrants(admin, 'mysql')
      expect(afterRevoke.grants.some((g) => g.account === 'grants_probe@%' && g.privilege === 'INSERT')).toBe(false)

      // 제한 계정 — 자기 권한만 + "못 본다" 경고 (없다 ≠ 못 본다)
      const probe = await mysql.createConnection({
        host: 'localhost',
        port: 13306,
        user: 'grants_probe',
        password: 'probe',
        database: 'testdb'
      })
      try {
        const limited = await introspectMysqlGrants(probe, 'mysql')
        expect(limited.accounts.map((a) => a.account)).toEqual(['grants_probe@%'])
        expect(limited.accounts[0].isCurrent).toBe(true)
        expect(limited.warnings.length).toBeGreaterThan(0)
        expect(limited.grants.some((g) => g.privilege === 'SELECT' && g.table === 'users')).toBe(true)
      } finally {
        await probe.end()
      }
    } finally {
      await admin.query("DROP USER IF EXISTS 'grants_probe'@'%'")
      await admin.end()
    }
  })

  it('postgresql: role IR → GRANT/REVOKE 왕복 · PUBLIC/소유자 기본권한이 IR 에 나온다', async () => {
    const client = new pg.Client({ host: 'localhost', port: 15432, database: 'testdb', user: 'test', password: 'test' })
    await client.connect()
    try {
      await client.query('DROP ROLE IF EXISTS grants_probe')
      await client.query('CREATE ROLE grants_probe')
      await client.query('GRANT SELECT ON users TO grants_probe')

      const ir = await introspectPgGrants(client)
      expect(ir.accounts.some((a) => a.account === 'grants_probe')).toBe(true)
      expect(
        ir.grants.some((g) => g.account === 'grants_probe' && g.privilege === 'SELECT' && g.table === 'users')
      ).toBe(true)
      // ACL 이 NULL 인 표(권한을 아무에게도 안 준 표)는 소유자 기본권한으로 나온다
      expect(ir.grants.some((g) => g.implicit)).toBe(true)

      const plan = buildStatements(
        'postgresql',
        [{ account: 'grants_probe', db: 'public', table: 'users', privilege: 'INSERT', kind: 'missing' }],
        { includeRevoke: false, currentAccount: 'test' }
      )
      for (const st of plan.statements) await client.query(st.sql)
      const after = await introspectPgGrants(client)
      expect(after.grants.some((g) => g.account === 'grants_probe' && g.privilege === 'INSERT')).toBe(true)

      const revoke = buildStatements(
        'postgresql',
        [{ account: 'grants_probe', db: 'public', table: 'users', privilege: 'INSERT', kind: 'excess', layer: 'table' }],
        { includeRevoke: true, currentAccount: 'test' }
      )
      for (const st of revoke.statements) await client.query(st.sql)
      const reverted = await introspectPgGrants(client)
      expect(reverted.grants.some((g) => g.account === 'grants_probe' && g.privilege === 'INSERT')).toBe(false)
    } finally {
      await client.query('REVOKE ALL ON users FROM grants_probe').catch(() => {})
      await client.query('DROP ROLE IF EXISTS grants_probe').catch(() => {})
      await client.end()
    }
  })
})
