import { describe, expect, it } from 'vitest'
import type { Column, Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'
import { generateMigration } from './ddlDiff'

function col(name: string, type: string, opts: Partial<Column> = {}): Column {
  return { id: `c:${name}`, name, type, nullable: false, defaultValue: null, comment: '', ...opts }
}
function tbl(name: string, columns: Column[], constraints: Constraint[] = []): TableDef {
  return { id: `t:${name}`, designId: 'd', name, comment: '', columns, constraints }
}
const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

const usersBase = tbl(
  'users',
  [col('id', 'char(36)'), col('email', 'varchar(255)')],
  [{ id: 'k:pk', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 'c:id' }] }]
)

describe('generateMigration — 테이블 수준', () => {
  it('새 테이블 → CREATE', () => {
    const plan = generateMigration(snap([]), snap([usersBase]), 'mysql')
    expect(plan.statements).toHaveLength(1)
    expect(plan.statements[0].kind).toBe('create')
    expect(plan.statements[0].sql).toContain('CREATE TABLE `users`')
    expect(plan.destructiveCount).toBe(0)
  })

  it('삭제된 테이블 → DROP (파괴적)', () => {
    const plan = generateMigration(snap([usersBase]), snap([]), 'postgresql')
    expect(plan.statements[0]).toMatchObject({ kind: 'drop', destructive: true })
    expect(plan.statements[0].sql).toBe('DROP TABLE "users";')
    expect(plan.destructiveCount).toBe(1)
  })

  it('변경 없음 → 빈 계획', () => {
    const plan = generateMigration(snap([usersBase]), snap([usersBase]), 'mysql')
    expect(plan.statements).toEqual([])
  })

  it('테이블 이름 변경 → RENAME', () => {
    const renamed = { ...usersBase, name: 'accounts' }
    const plan = generateMigration(snap([usersBase]), snap([renamed]), 'postgresql')
    expect(plan.statements.some((s) => s.sql === 'ALTER TABLE "users" RENAME TO "accounts";')).toBe(true)
  })
})

describe('generateMigration — 컬럼', () => {
  it('컬럼 추가 → ADD COLUMN', () => {
    const target = tbl('users', [...usersBase.columns, col('age', 'int', { nullable: true })], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'mysql')
    expect(plan.statements.some((s) => s.sql === 'ALTER TABLE `users` ADD COLUMN `age` int NULL;')).toBe(true)
  })

  it('컬럼 삭제 → DROP COLUMN (파괴적)', () => {
    const target = tbl('users', [col('id', 'char(36)')], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    const drop = plan.statements.find((s) => s.sql.includes('DROP COLUMN'))
    expect(drop).toMatchObject({ destructive: true })
    expect(drop!.sql).toBe('ALTER TABLE "users" DROP COLUMN "email";')
    expect(plan.destructiveCount).toBe(1)
  })

  it('컬럼 타입/NULL 변경 — pg 는 ALTER COLUMN 분해', () => {
    const target = tbl(
      'users',
      [col('id', 'char(36)'), col('email', 'text', { nullable: true })],
      usersBase.constraints
    )
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    const sqls = plan.statements.map((s) => s.sql)
    expect(sqls).toContain('ALTER TABLE "users" ALTER COLUMN "email" TYPE text;')
    expect(sqls).toContain('ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;')
  })

  it('컬럼 변경 — mysql 은 MODIFY COLUMN', () => {
    const target = tbl(
      'users',
      [col('id', 'char(36)'), col('email', 'varchar(320)')],
      usersBase.constraints
    )
    const plan = generateMigration(snap([usersBase]), snap([target]), 'mysql')
    expect(plan.statements.some((s) => s.sql === 'ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;')).toBe(true)
  })

  it('컬럼 이름 변경 — mysql CHANGE / pg RENAME', () => {
    const renamed = tbl(
      'users',
      [col('id', 'char(36)'), { ...col('email_addr', 'varchar(255)'), id: 'c:email' }],
      usersBase.constraints
    )
    const my = generateMigration(snap([usersBase]), snap([renamed]), 'mysql')
    expect(my.statements.some((s) => s.sql.startsWith('ALTER TABLE `users` CHANGE COLUMN `email`'))).toBe(true)
    const pg = generateMigration(snap([usersBase]), snap([renamed]), 'postgresql')
    expect(pg.statements.some((s) => s.sql === 'ALTER TABLE "users" RENAME COLUMN "email" TO "email_addr";')).toBe(true)
  })

  it('sqlite 정의 변경은 미지원으로 기록', () => {
    const target = tbl('users', [col('id', 'char(36)'), col('email', 'blob')], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'sqlite')
    expect(plan.unsupported.length).toBeGreaterThan(0)
    expect(plan.unsupported[0]).toContain('테이블 재생성')
  })
})

describe('generateMigration — 제약', () => {
  const fk: Constraint = {
    id: 'k:fk',
    kind: 'fk',
    name: 'fk_users_org',
    columns: [{ columnId: 'c:org_id' }],
    refTable: 'orgs',
    refColumns: ['id'],
    onDelete: 'CASCADE'
  }
  const withOrg = tbl('users', [...usersBase.columns, col('org_id', 'char(36)', { nullable: true })], usersBase.constraints)

  it('FK 추가 → ADD CONSTRAINT + ON DELETE', () => {
    const target = tbl('users', withOrg.columns, [...usersBase.constraints, fk])
    const plan = generateMigration(snap([withOrg]), snap([target]), 'postgresql')
    const add = plan.statements.find((s) => s.sql.includes('ADD CONSTRAINT'))
    expect(add!.sql).toBe(
      'ALTER TABLE "users" ADD CONSTRAINT "fk_users_org" FOREIGN KEY ("org_id") REFERENCES "orgs" ("id") ON DELETE CASCADE;'
    )
  })

  it('제약 삭제 — pg DROP CONSTRAINT / mysql DROP FOREIGN KEY (파괴적)', () => {
    const base = tbl('users', withOrg.columns, [...usersBase.constraints, fk])
    const target = tbl('users', withOrg.columns, usersBase.constraints)
    const pg = generateMigration(snap([base]), snap([target]), 'postgresql')
    expect(pg.statements.some((s) => s.sql === 'ALTER TABLE "users" DROP CONSTRAINT "fk_users_org";' && s.destructive)).toBe(true)
    const my = generateMigration(snap([base]), snap([target]), 'mysql')
    expect(my.statements.some((s) => s.sql === 'ALTER TABLE `users` DROP FOREIGN KEY `fk_users_org`;')).toBe(true)
  })

  it('인덱스 추가 → CREATE INDEX', () => {
    const idx: Constraint = { id: 'k:idx', kind: 'idx', name: 'idx_users_email', columns: [{ columnId: 'c:email' }] }
    const target = tbl('users', usersBase.columns, [...usersBase.constraints, idx])
    const plan = generateMigration(snap([usersBase]), snap([target]), 'mysql')
    const ci = plan.statements.find((s) => s.kind === 'index')
    expect(ci!.sql).toBe('CREATE INDEX `idx_users_email` ON `users` (`email`);')
  })

  it('sqlite 제약 삭제는 미지원', () => {
    const base = tbl('users', withOrg.columns, [...usersBase.constraints, fk])
    const target = tbl('users', withOrg.columns, usersBase.constraints)
    const plan = generateMigration(snap([base]), snap([target]), 'sqlite')
    expect(plan.unsupported.some((u) => u.includes('제약 삭제'))).toBe(true)
  })
})

// 4단계 — 스키마가 섞이면 반영 계획도 한정 이름을 쓴다(§db-remote.scope).
describe('generateMigration — 스키마 한정', () => {
  const scoped = (schema: string, name: string): TableDef => ({
    id: `t:${schema}.${name}`,
    designId: 'd',
    schema,
    name,
    comment: '',
    columns: [{ id: `c:${schema}.${name}.id`, name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, comment: '' }],
    constraints: []
  })
  const snap = (tables: TableDef[]) => ({ tables }) as never

  it('스키마가 하나뿐이면 한정 이름을 안 쓴다 — 예전 계획과 글자가 같아야 한다', () => {
    const plan = generateMigration(snap([]), snap([scoped('public', 'users')]), 'postgresql')
    expect(plan.statements[0].sql).toContain('CREATE TABLE "users"')
    expect(plan.statements[0].sql).not.toContain('"public"."users"')
    expect(plan.statements[0].table).toBe('users')
  })

  it('스키마가 섞이면 DDL·표시 이름 둘 다 한정 이름', () => {
    const plan = generateMigration(
      snap([scoped('public', 'posts')]),
      snap([scoped('public', 'posts'), scoped('auth', 'accounts')]),
      'postgresql'
    )
    const created = plan.statements.find((s) => s.kind === 'create')!
    expect(created.sql).toContain('CREATE TABLE "auth"."accounts"')
    expect(created.table).toBe('auth.accounts')
  })

  it('삭제도 한정 이름으로 — 다른 스키마의 동명 테이블을 지우면 안 된다', () => {
    const plan = generateMigration(
      snap([scoped('auth', 'members'), scoped('public', 'members')]),
      snap([scoped('public', 'members')]),
      'postgresql'
    )
    const drop = plan.statements.find((s) => s.kind === 'drop')!
    expect(drop.sql).toBe('DROP TABLE "auth"."members";')
  })

  it('스키마 이동은 SET SCHEMA 로 낸다 — 안 내면 옛 스키마에 그대로 남는다', () => {
    const before = scoped('public', 'members')
    const after = { ...before, schema: 'auth' }
    const plan = generateMigration(snap([before, scoped('auth', 'x')]), snap([after, scoped('auth', 'x')]), 'postgresql')
    expect(plan.statements.some((s) => s.sql === 'ALTER TABLE "public"."members" SET SCHEMA "auth";')).toBe(true)
  })
})
