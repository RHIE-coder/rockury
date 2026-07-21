import { describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import { introspectMysql } from './mysql'
import { introspectPg } from './postgres'
import { introspectSqlite } from './sqlite'
import type { IntrospectedSchema } from './types'

/**
 * 벤더 어댑터의 실 DB 통합 테스트 — test-db(docker + sqlite 파일)에 실제로 붙어 검증한다.
 * docker 의존이라 기본 `npm test` 에서는 skip. 실행: `INTROSPECT_IT=1 npx vitest run introspection.integration`
 * (사전에 `npm run db:up`).
 */
const IT = !!process.env.INTROSPECT_IT
const SQLITE_FILE = path.resolve(__dirname, '../../../../scripts/test-db/data/testdb.sqlite')

/** 벤더 공통 최소 기대치: users(pk id, uk email) + user_roles(복합 pk + 2 fk). */
function assertCoreSchema(s: IntrospectedSchema): void {
  const names = s.tables.map((t) => t.name)
  expect(names).toContain('users')
  expect(names).toContain('user_roles')

  const userCols = s.columns.filter((c) => c.table === 'users').map((c) => c.name)
  expect(userCols).toContain('id')
  expect(userCols).toContain('email')

  const usersPk = s.keys.filter((k) => k.table === 'users' && k.kind === 'pk')
  expect(usersPk.map((k) => k.column)).toContain('id')

  // user_roles 복합 PK(user_id, role_id)
  const urPk = s.keys
    .filter((k) => k.table === 'user_roles' && k.kind === 'pk')
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((k) => k.column)
  expect(urPk).toEqual(['user_id', 'role_id'])

  // user_roles FK 2개 → users / roles
  const urFkTables = s.foreignKeys.filter((f) => f.table === 'user_roles').map((f) => f.refTable)
  expect(urFkTables).toContain('users')
  expect(urFkTables).toContain('roles')
}

describe.skipIf(!IT)('introspection 통합(test-db)', () => {
  it('mysql (13306)', async () => {
    const conn = await mysql.createConnection({ host: 'localhost', port: 13306, database: 'testdb', user: 'test', password: 'test' })
    try {
      const s = await introspectMysql(conn, 'mysql')
      assertCoreSchema(s)
      // users.email 에 UNIQUE
      expect(s.keys.some((k) => k.table === 'users' && k.kind === 'uk' && k.column === 'email')).toBe(true)
    } finally {
      await conn.end()
    }
  })

  it('mariadb (13307)', async () => {
    const conn = await mysql.createConnection({ host: 'localhost', port: 13307, database: 'testdb', user: 'test', password: 'test' })
    try {
      assertCoreSchema(await introspectMysql(conn, 'mariadb'))
    } finally {
      await conn.end()
    }
  })

  it('postgresql (15432)', async () => {
    const client = new pg.Client({ host: 'localhost', port: 15432, database: 'testdb', user: 'test', password: 'test' })
    await client.connect()
    try {
      const s = await introspectPg(client)
      assertCoreSchema(s)
      // 파티션 자식 테이블은 제외됐는지(orders 부모만, orders_2025_h1 없음)
      expect(s.tables.map((t) => t.name)).toContain('orders')
      expect(s.tables.map((t) => t.name)).not.toContain('orders_2025_h1')
    } finally {
      await client.end()
    }
  })

  it('sqlite (파일, readOnly)', () => {
    const db = new DatabaseSync(SQLITE_FILE, { readOnly: true })
    try {
      assertCoreSchema(introspectSqlite(db))
    } finally {
      db.close()
    }
  })
})
