import { describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import { introspectMysql, listMysqlSchemas } from './mysql'
import { introspectPg, listPgCatalogs, listPgSchemas } from './postgres'
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
      const s = introspectSqlite(db)
      assertCoreSchema(s)
      expect(s.schemas).toEqual(['main'])
    } finally {
      db.close()
    }
  })

  // 범위(scope) — 여러 스키마를 한 번에 읽고, 안 고른 스키마는 안 들어온다.
  it('postgresql: 스키마 두 개를 함께 읽는다 + 교차 스키마 FK 가 refSchema 를 달고 나온다', async () => {
    const client = new pg.Client({ host: 'localhost', port: 15432, database: 'testdb', user: 'test', password: 'test' })
    await client.connect()
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS scope_a')
      await client.query('CREATE SCHEMA IF NOT EXISTS scope_b')
      await client.query('CREATE TABLE IF NOT EXISTS scope_a.owners (id bigint PRIMARY KEY)')
      // 이름이 같은 테이블을 양쪽에 둔다 — 이름만으로 이으면 여기서 틀린다.
      await client.query('CREATE TABLE IF NOT EXISTS scope_b.owners (id bigint PRIMARY KEY)')
      await client.query(
        `CREATE TABLE IF NOT EXISTS scope_b.items (
           id bigint PRIMARY KEY,
           owner_id bigint REFERENCES scope_a.owners(id))`
      )

      const both = await introspectPg(client, ['scope_a', 'scope_b'])
      expect(both.schemas).toEqual(['scope_a', 'scope_b'])
      expect(both.tables.filter((t) => t.name === 'owners').map((t) => t.schema).sort()).toEqual([
        'scope_a',
        'scope_b'
      ])
      const fk = both.foreignKeys.find((f) => f.table === 'items')!
      expect([fk.schema, fk.refSchema, fk.refTable]).toEqual(['scope_b', 'scope_a', 'owners'])

      // 한쪽만 고르면 다른 쪽은 안 들어온다 — 그래도 FK 는 밖(scope_a)을 가리킨 채로 남는다.
      const only = await introspectPg(client, ['scope_b'])
      expect(only.tables.map((t) => t.schema)).toEqual(['scope_b', 'scope_b'])
      expect(only.foreignKeys.find((f) => f.table === 'items')?.refSchema).toBe('scope_a')

      expect(await listPgSchemas(client)).toEqual(expect.arrayContaining(['public', 'scope_a', 'scope_b']))
      expect(await listPgCatalogs(client)).toContain('testdb')
    } finally {
      await client.query('DROP SCHEMA IF EXISTS scope_b CASCADE')
      await client.query('DROP SCHEMA IF EXISTS scope_a CASCADE')
      await client.end()
    }
  })

  it('mysql: database 두 개를 함께 읽는다(MySQL 의 database 가 곧 스키마 자리)', async () => {
    const conn = await mysql.createConnection({ host: 'localhost', port: 13306, user: 'root', password: 'root' })
    try {
      await conn.query('CREATE DATABASE IF NOT EXISTS scope_a')
      await conn.query('CREATE DATABASE IF NOT EXISTS scope_b')
      await conn.query('CREATE TABLE IF NOT EXISTS scope_a.owners (id BIGINT PRIMARY KEY)')
      await conn.query('CREATE TABLE IF NOT EXISTS scope_b.owners (id BIGINT PRIMARY KEY)')

      const both = await introspectMysql(conn, 'mysql', ['scope_a', 'scope_b'])
      expect(both.tables.map((t) => `${t.schema}.${t.name}`).sort()).toEqual([
        'scope_a.owners',
        'scope_b.owners'
      ])
      expect(await listMysqlSchemas(conn)).toEqual(expect.arrayContaining(['scope_a', 'scope_b']))
    } finally {
      await conn.query('DROP DATABASE IF EXISTS scope_b')
      await conn.query('DROP DATABASE IF EXISTS scope_a')
      await conn.end()
    }
  })
})
