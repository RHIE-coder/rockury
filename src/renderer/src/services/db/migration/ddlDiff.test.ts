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
  /** 스키마를 모르는 표 — 선언 기능 이전 설계에 남아 있는 모양. */
  const unscoped = (name: string): TableDef => ({ ...scoped('x', name), schema: undefined, id: `t:${name}` })
  const snap = (tables: TableDef[]) => ({ tables }) as never

  // 2026-08-11 규칙 변경 — 예전엔 "하나뿐이면 안 붙인다"였다. 그러면 나간 문이 어느 DB 에
  // 떨어지는지가 그때 USE 된 DB 에 달려, 엉뚱한 데이터베이스에 반영될 수 있었다.
  it('하나뿐이어도 이름을 알면 한정 이름을 쓴다 — 목적지가 SQL 에 적혀야 한다', () => {
    const plan = generateMigration(snap([]), snap([scoped('public', 'users')]), 'postgresql')
    expect(plan.statements[0].sql).toContain('CREATE TABLE "public"."users"')
    expect(plan.statements[0].table).toBe('public.users')
  })

  it('이름 모르는 표가 섞이면 안 붙인다 — 반쯤 한정된 SQL 이 가장 나쁘다', () => {
    const plan = generateMigration(snap([]), snap([scoped('public', 'users'), unscoped('logs')]), 'postgresql')
    for (const st of plan.statements) expect(st.sql).not.toContain('"public".')
  })

  it('sqlite 는 붙일 층이 없어 언제나 이름만', () => {
    const plan = generateMigration(snap([]), snap([scoped('main', 'users')]), 'sqlite')
    expect(plan.statements[0].sql).toContain('CREATE TABLE "users"')
    expect(plan.statements[0].sql).not.toContain('"main"')
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

  it('테이블 설명도 한정 이름으로 — 동명 테이블에 잘못 붙으면 안 된다', () => {
    const before = scoped('auth', 'members')
    const after = { ...before, comment: '가입 회원' }
    const plan = generateMigration(snap([before, scoped('public', 'members')]), snap([after, scoped('public', 'members')]), 'postgresql')
    expect(plan.statements.some((s) => s.sql === `COMMENT ON TABLE "auth"."members" IS '가입 회원';`)).toBe(true)
  })
})

// 설명(comment)만 고쳐도 반영 계획이 비면 안 된다 — 비면 화면의 `적용` 버튼이 안 켜진다.
describe('generateMigration — 설명(comment)', () => {
  const withComment = (t: TableDef, colName: string, comment: string): TableDef => ({
    ...t,
    columns: t.columns.map((c) => (c.name === colName ? { ...c, comment } : c))
  })

  it('PG 컬럼 설명만 바꿔도 COMMENT ON COLUMN 이 나온다', () => {
    const target = withComment(usersBase, 'email', '로그인 이메일')
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    expect(plan.statements.map((s) => s.sql)).toEqual([
      `COMMENT ON COLUMN "users"."email" IS '로그인 이메일';`
    ])
    expect(plan.destructiveCount).toBe(0)
  })

  it('PG 컬럼 설명을 지우면 빈 문자열이 아니라 NULL', () => {
    const base = withComment(usersBase, 'email', '옛 설명')
    const plan = generateMigration(snap([base]), snap([usersBase]), 'postgresql')
    expect(plan.statements[0].sql).toBe('COMMENT ON COLUMN "users"."email" IS NULL;')
  })

  it('PG 컬럼 이름과 설명을 함께 바꾸면 설명은 새 이름에 붙는다', () => {
    const target = {
      ...usersBase,
      columns: usersBase.columns.map((c) => (c.name === 'email' ? { ...c, name: 'login_id', comment: '로그인 아이디' } : c))
    }
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    const sqls = plan.statements.map((s) => s.sql)
    expect(sqls).toContain('ALTER TABLE "users" RENAME COLUMN "email" TO "login_id";')
    expect(sqls).toContain(`COMMENT ON COLUMN "users"."login_id" IS '로그인 아이디';`)
    expect(sqls.indexOf('ALTER TABLE "users" RENAME COLUMN "email" TO "login_id";')).toBeLessThan(
      sqls.indexOf(`COMMENT ON COLUMN "users"."login_id" IS '로그인 아이디';`)
    )
  })

  it('PG 새 컬럼의 설명도 따라간다 — ADD COLUMN 절엔 못 싣는다', () => {
    const target = tbl('users', [...usersBase.columns, col('age', 'int', { nullable: true, comment: '나이' })], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    const sqls = plan.statements.map((s) => s.sql)
    expect(sqls).toContain('ALTER TABLE "users" ADD COLUMN "age" int NULL;')
    expect(sqls).toContain(`COMMENT ON COLUMN "users"."age" IS '나이';`)
  })

  it('MySQL 컬럼 설명은 MODIFY COLUMN 에 딸려 간다', () => {
    const target = withComment(usersBase, 'email', '로그인 이메일')
    const plan = generateMigration(snap([usersBase]), snap([target]), 'mysql')
    expect(plan.statements.map((s) => s.sql)).toEqual([
      "ALTER TABLE `users` MODIFY COLUMN `email` varchar(255) NOT NULL COMMENT '로그인 이메일';"
    ])
  })

  it('PG 테이블 설명 변경 → COMMENT ON TABLE', () => {
    const target = { ...usersBase, comment: '사용자' }
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    expect(plan.statements.map((s) => s.sql)).toEqual([`COMMENT ON TABLE "users" IS '사용자';`])
  })

  it("설명 속 따옴표는 이스케이프한다", () => {
    const target = withComment(usersBase, 'email', "it's here")
    const plan = generateMigration(snap([usersBase]), snap([target]), 'postgresql')
    expect(plan.statements[0].sql).toBe(`COMMENT ON COLUMN "users"."email" IS 'it''s here';`)
  })

  // sqlite 는 설명을 저장할 자리가 없다 — 문을 못 내는 대신 이유를 남겨야
  // 화면이 "변경 없음"으로만 보이지 않는다.
  it('sqlite 컬럼 설명 변경 → 문 대신 미지원 사유', () => {
    const target = withComment(usersBase, 'email', '로그인 이메일')
    const plan = generateMigration(snap([usersBase]), snap([target]), 'sqlite')
    expect(plan.statements).toEqual([])
    expect(plan.unsupported).toEqual(['sqlite: users.email 컬럼 설명은 sqlite 가 저장하지 않는다'])
  })

  it('sqlite 테이블 설명 변경 → 문 대신 미지원 사유', () => {
    const target = { ...usersBase, comment: '사용자' }
    const plan = generateMigration(snap([usersBase]), snap([target]), 'sqlite')
    expect(plan.statements).toEqual([])
    expect(plan.unsupported).toEqual(['sqlite: users 테이블 설명은 sqlite 가 저장하지 않는다'])
  })

  it('sqlite 새 컬럼의 설명도 버려진다고 알린다', () => {
    const target = tbl('users', [...usersBase.columns, col('age', 'int', { nullable: true, comment: '나이' })], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'sqlite')
    expect(plan.statements.some((s) => s.sql.includes('ADD COLUMN'))).toBe(true)
    expect(plan.unsupported).toEqual(['sqlite: users.age 컬럼 설명은 sqlite 가 저장하지 않는다'])
  })

  it('sqlite 새 테이블의 설명도 버려진다고 알린다', () => {
    const target = { ...tbl('notes', [col('id', 'INTEGER')]), comment: '메모' }
    const plan = generateMigration(snap([]), snap([target]), 'sqlite')
    expect(plan.statements[0].kind).toBe('create')
    expect(plan.unsupported).toEqual(['sqlite: notes 의 설명은 sqlite 가 저장하지 않는다'])
  })

  it('설명을 안 건드린 sqlite 변경은 사유를 안 남긴다', () => {
    const target = tbl('users', [...usersBase.columns, col('age', 'int', { nullable: true })], usersBase.constraints)
    const plan = generateMigration(snap([usersBase]), snap([target]), 'sqlite')
    expect(plan.unsupported).toEqual([])
  })
})
