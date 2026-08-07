import { describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import { introspectMysql, listMysqlSchemas, parseCreateTableForeignKeys } from './mysql'
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

  // information_schema 를 못 보는 계정용 대체 경로가 **같은 답**을 내는지 실물로 대조한다.
  // 개수를 함께 본다 — 양쪽 다 0이면 "일치"가 아니라 아무것도 안 본 것이다.
  it.each([
    ['mysql', 13306] as const,
    ['mariadb', 13307] as const
  ])('%s: SHOW CREATE TABLE 로 읽은 FK 가 information_schema 와 같다', async (dialect, port) => {
    const conn = await mysql.createConnection({ host: 'localhost', port, database: 'testdb', user: 'test', password: 'test' })
    try {
      const viaIs = (await introspectMysql(conn, dialect)).foreignKeys.filter(
        (f) => f.table === 'user_roles'
      )
      const [rows] = await conn.query('SHOW CREATE TABLE `testdb`.`user_roles`')
      const ddl = (rows as Record<string, string>[])[0]['Create Table']
      const viaDdl = parseCreateTableForeignKeys('testdb', 'user_roles', ddl)

      const order = (a: { name: string; ordinal: number }, b: { name: string; ordinal: number }) =>
        a.name.localeCompare(b.name) || a.ordinal - b.ordinal
      expect(viaIs.length).toBeGreaterThan(0)
      expect(viaDdl.length).toBe(viaIs.length)
      expect([...viaDdl].sort(order)).toEqual([...viaIs].sort(order))
    } finally {
      await conn.end()
    }
  })

  // CHECK 는 벤더마다 사는 곳이 다르다(MySQL/MariaDB 는 information_schema, PostgreSQL 은
  // pg_constraint, SQLite 는 CREATE 문 글자). 넷 다 **같은 식**으로 접히는지 실물로 본다.
  it.each([
    ['mysql', 13306] as const,
    ['mariadb', 13307] as const
  ])('%s: CHECK 를 식과 함께 읽는다', async (dialect, port) => {
    const conn = await mysql.createConnection({ host: 'localhost', port, database: 'testdb', user: 'test', password: 'test' })
    try {
      await conn.query('DROP TABLE IF EXISTS chk_probe')
      await conn.query('CREATE TABLE chk_probe (id INT PRIMARY KEY, price INT, CONSTRAINT chk_probe_price CHECK (price > 0))')
      const found = (await introspectMysql(conn, dialect)).checks.filter((c) => c.table === 'chk_probe')
      expect(found).toHaveLength(1)
      expect(found[0].name).toBe('chk_probe_price')
      // 벤더가 식별자를 어떻게 인용하든 `price` 와 `> 0` 은 남아야 한다.
      expect(found[0].expression.replace(/[`"]/g, '')).toContain('price > 0')
    } finally {
      await conn.query('DROP TABLE IF EXISTS chk_probe')
      await conn.end()
    }
  })

  it('postgresql: CHECK 를 식과 함께 읽는다', async () => {
    const client = new pg.Client({ host: 'localhost', port: 15432, database: 'testdb', user: 'test', password: 'test' })
    await client.connect()
    try {
      await client.query('DROP TABLE IF EXISTS chk_probe')
      await client.query('CREATE TABLE chk_probe (id int PRIMARY KEY, price int CONSTRAINT chk_probe_price CHECK (price > 0))')
      const found = (await introspectPg(client)).checks.filter((c) => c.table === 'chk_probe')
      expect(found.map((c) => c.name)).toEqual(['chk_probe_price'])
      // `CHECK ((price > 0))` 의 껍데기가 다 벗겨졌는지 — 안 벗기면 설계부 식과 영영 안 맞는다.
      expect(found[0].expression).toBe('price > 0')
    } finally {
      await client.query('DROP TABLE IF EXISTS chk_probe')
      await client.end()
    }
  })

  it('sqlite: CHECK 를 CREATE 문에서 읽는다', () => {
    const db = new DatabaseSync(SQLITE_FILE, { readOnly: true })
    try {
      // 읽기 전용이라 표를 못 만든다 — 파일에 이미 있는 것 중 CHECK 가 있으면 식이 비면 안 된다.
      for (const c of introspectSqlite(db).checks) expect(c.expression.length).toBeGreaterThan(0)
    } finally {
      db.close()
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
