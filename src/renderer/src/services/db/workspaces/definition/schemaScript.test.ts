import { describe, expect, it } from 'vitest'
import type { Column, Constraint, TableDef } from './types'
import { generateSchemaScript, orderForCreate } from './schemaScript'

const col = (id: string, name: string, extra: Partial<Column> = {}): Column => ({
  id,
  name,
  type: 'BIGINT',
  nullable: false,
  defaultValue: null,
  comment: '',
  ...extra
})

/** `fks` = [내 컬럼, 참조 테이블] 쌍. 모든 테이블은 id PK 를 갖는다. */
function tbl(name: string, fks: [string, string][] = [], isView = false): TableDef {
  const columns: Column[] = [
    col(`${name}.id`, 'id'),
    ...fks.map(([c]) => col(`${name}.${c}`, c, { nullable: true }))
  ]
  const constraints: Constraint[] = [
    { id: `${name}.pk`, kind: 'pk', name: `pk_${name}`, columns: [{ columnId: `${name}.id` }] },
    ...fks.map(([c, ref]): Constraint => ({
      id: `${name}.fk_${c}`,
      kind: 'fk',
      name: `fk_${name}_${c}`,
      columns: [{ columnId: `${name}.${c}` }],
      refTable: ref,
      refColumns: ['id'],
      onDelete: 'CASCADE'
    }))
  ]
  return { id: name, designId: 'd', name, comment: '', columns, constraints, isView }
}

const names = (ts: TableDef[]): string[] => ts.map((t) => t.name)

describe('orderForCreate — 참조당하는 테이블이 먼저', () => {
  it('이름순으로 들어와도 의존 순서로 뒤집는다', () => {
    // orders → users, order_items → orders. 이름순이면 order_items, orders, users 순.
    const input = [tbl('order_items', [['order_id', 'orders']]), tbl('orders', [['user_id', 'users']]), tbl('users')]
    expect(names(orderForCreate(input, 'postgresql').tables)).toEqual(['users', 'orders', 'order_items'])
  })

  it('뷰는 테이블을 다 만든 뒤에 온다', () => {
    const input = [tbl('v_active', [], true), tbl('users')]
    expect(names(orderForCreate(input, 'postgresql').tables)).toEqual(['users', 'v_active'])
  })

  it('자기 참조는 순서에 걸리지 않는다', () => {
    const input = [tbl('employees', [['manager_id', 'employees']])]
    const { tables, deferred } = orderForCreate(input, 'postgresql')
    expect(names(tables)).toEqual(['employees'])
    expect(deferred).toHaveLength(0)
  })

  it('목록 밖 테이블을 가리키는 FK 는 순서에 걸리지 않는다', () => {
    // 다른 스키마 테이블 등 — 정렬로 풀 수 있는 문제가 아니라 그대로 둔다.
    const input = [tbl('orders', [['tenant_id', 'other_schema_tenants']])]
    const { tables, deferred } = orderForCreate(input, 'postgresql')
    expect(names(tables)).toEqual(['orders'])
    expect(deferred).toHaveLength(0)
  })

  it('입력이 같으면 결과도 같다(스크립트 diff 가 흔들리지 않게)', () => {
    const input = [tbl('b', [['a_id', 'a']]), tbl('a'), tbl('c')]
    const once = names(orderForCreate(input, 'mysql').tables)
    expect(names(orderForCreate(input, 'mysql').tables)).toEqual(once)
  })
})

describe('orderForCreate — 서로 참조하는 고리', () => {
  const cycle = (): TableDef[] => [tbl('teams', [['lead_id', 'users']]), tbl('users', [['team_id', 'teams']])]

  it('한쪽 FK 를 CREATE 에서 빼고 뒤로 미룬다 — 모든 테이블은 그대로 나온다', () => {
    const { tables, deferred } = orderForCreate(cycle(), 'postgresql')
    expect(names(tables).sort()).toEqual(['teams', 'users'])
    expect(deferred).toHaveLength(1)
    expect(deferred[0].constraint.refTable).toBe('users')
  })

  it('미룬 FK 는 스크립트 끝에서 ALTER 로 걸린다', () => {
    const sql = generateSchemaScript(cycle(), 'postgresql')
    expect(sql).toMatch(
      /ALTER TABLE "teams" ADD CONSTRAINT "fk_teams_lead_id" FOREIGN KEY \("lead_id"\) REFERENCES "users" \("id"\) ON DELETE CASCADE;/
    )
    // 뺀 자리에 남아 있으면 CREATE 가 없는 테이블을 가리켜 실패한다.
    const createTeams = sql.slice(sql.indexOf('CREATE TABLE "teams"'), sql.indexOf('CREATE TABLE "users"'))
    expect(createTeams).not.toContain('fk_teams_lead_id')
    expect(sql.indexOf('ALTER TABLE')).toBeGreaterThan(sql.indexOf('CREATE TABLE "users"'))
  })

  it('sqlite 는 미루지 않는다 — 정방향 참조가 되고 ALTER ADD CONSTRAINT 가 없다', () => {
    const { deferred } = orderForCreate(cycle(), 'sqlite')
    expect(deferred).toHaveLength(0)
    expect(generateSchemaScript(cycle(), 'sqlite')).not.toContain('ADD CONSTRAINT')
  })
})

describe('generateSchemaScript', () => {
  it('모든 테이블의 CREATE 를 한 스크립트에 담는다', () => {
    const sql = generateSchemaScript([tbl('orders', [['user_id', 'users']]), tbl('users')], 'mysql')
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).toContain('CREATE TABLE `orders`')
    expect(sql.indexOf('`users`')).toBeLessThan(sql.indexOf('CREATE TABLE `orders`'))
  })

  it('첫 줄은 실행되는 문장이다 — 자명한 것을 머리 주석으로 되풀이하지 않는다', () => {
    const sql = generateSchemaScript([tbl('users')], 'postgresql')
    expect(sql.split('\n')[0].startsWith('--')).toBe(false)
  })

  it('테이블 사이는 빈 줄로 가른다', () => {
    const sql = generateSchemaScript([tbl('a'), tbl('b')], 'postgresql')
    expect(sql).toMatch(/\);\n\nCREATE TABLE "b"/)
  })

  it('빈 스키마는 빈 문자열', () => {
    expect(generateSchemaScript([], 'postgresql')).toBe('')
  })
})

// 범위(scope)를 켜면 같은 이름 테이블이 여러 스키마에서 함께 온다(§db-remote.scope).
// 의존 순서를 이름으로만 따지면 엉뚱한 테이블을 "먼저"로 잡아 스크립트 순서가 뒤집힌다.
describe('orderForCreate — 여러 스키마', () => {
  /** `fks` = [내 컬럼, 참조 테이블, 참조 스키마] — 참조 스키마를 이름과 따로 준다. */
  const scoped = (schema: string, name: string, fks: [string, string, string?][] = []): TableDef => {
    const base = tbl(
      name,
      fks.map(([c, ref]) => [c, ref] as [string, string])
    )
    const refSchemaOf = new Map(fks.map(([c, , refSchema]) => [`${name}.fk_${c}`, refSchema]))
    return {
      ...base,
      id: `${schema}.${name}`,
      schema,
      constraints: base.constraints.map((k) =>
        k.kind === 'fk' ? { ...k, refSchema: refSchemaOf.get(k.id) } : k
      )
    }
  }

  it('refSchema 가 가리키는 테이블을 먼저 만든다', () => {
    // public.posts → auth.users. 이름만 보면 public.users 를 의존으로 잡는다.
    const input = [
      scoped('public', 'posts', [['author_id', 'users', 'auth']]),
      scoped('public', 'users'),
      scoped('auth', 'users')
    ]
    const order = orderForCreate(input, 'postgresql').tables.map((t) => `${t.schema}.${t.name}`)
    expect(order.indexOf('auth.users')).toBeLessThan(order.indexOf('public.posts'))
  })

  it('범위 밖 스키마를 가리키는 FK 는 순서에 안 걸린다 — 정렬로 풀 문제가 아니다', () => {
    const input = [scoped('public', 'posts', [['author_id', 'users', 'billing']])]
    const { tables, deferred } = orderForCreate(input, 'postgresql')
    expect(tables.map((t) => t.name)).toEqual(['posts'])
    expect(deferred).toHaveLength(0)
  })
})

// 3단계 — 스키마가 둘 이상이면 한정 이름을 쓰고 스키마부터 만든다.
describe('generateSchemaScript — 스키마 한정', () => {
  const scoped = (schema: string, name: string): TableDef => ({ ...tbl(name), id: `${schema}.${name}`, schema })
  /** 스키마를 모르는 표 — 선언 기능 이전 설계에 남아 있는 모양. */
  const unscoped = (name: string): TableDef => ({ ...tbl(name), id: name, schema: undefined })

  // 2026-08-11 규칙 변경 — 예전엔 "하나뿐이면 안 붙인다"였다. 그러면 스크립트가 어느 DB 에
  // 떨어지는지가 실행할 때의 세션 상태에 달린다.
  it('하나뿐이어도 이름을 알면 한정 이름을 쓴다 — 목적지가 스크립트에 적혀야 한다', () => {
    const sql = generateSchemaScript([scoped('public', 'users'), scoped('public', 'posts')], 'postgresql')
    expect(sql).toContain('CREATE TABLE "public"."users"')
    // PostgreSQL 의 public 은 새 DB 에 언제나 있으니 만들지 않는다.
    expect(sql).not.toContain('CREATE SCHEMA')
  })

  it('MySQL 은 선언한 DB 를 모두 만든다 — "언제나 있는 이름"이 없다', () => {
    const sql = generateSchemaScript([scoped('testdb', 'users')], 'mysql')
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS `testdb`;')
    expect(sql).toContain('CREATE TABLE `testdb`.`users`')
  })

  it('이름 모르는 표가 섞이면 안 붙인다 — 반쯤 한정된 스크립트가 가장 나쁘다', () => {
    const sql = generateSchemaScript([scoped('public', 'users'), unscoped('logs')], 'postgresql')
    expect(sql).not.toContain('"public".')
  })

  it('스키마가 섞이면 한정 이름 + CREATE SCHEMA 를 앞세운다', () => {
    const sql = generateSchemaScript([scoped('public', 'posts'), scoped('auth', 'accounts')], 'postgresql')
    expect(sql.startsWith('CREATE SCHEMA IF NOT EXISTS "auth";')).toBe(true)
    expect(sql).toContain('CREATE TABLE "auth"."accounts"')
    expect(sql).toContain('CREATE TABLE "public"."posts"')
    // 기본 스키마는 만들지 않는다 — PostgreSQL public 은 언제나 있다.
    expect(sql).not.toContain('CREATE SCHEMA IF NOT EXISTS "public"')
  })

  it('MySQL 은 스키마가 곧 database — CREATE DATABASE 로 낸다', () => {
    const sql = generateSchemaScript([scoped('service1', 'customers'), scoped('service2', 'orders')], 'mysql')
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS `service1`;')
    expect(sql).toContain('CREATE TABLE `service2`.`orders`')
  })

  it('SQLite 는 스키마 개념이 없다 — 한정도 CREATE SCHEMA 도 안 붙는다', () => {
    const sql = generateSchemaScript([scoped('main', 'a'), scoped('other', 'b')], 'sqlite')
    expect(sql).not.toContain('CREATE SCHEMA')
    expect(sql).not.toContain('"main"."a"')
    expect(sql).toContain('CREATE TABLE "a"')
  })

  it('교차 스키마 FK 는 참조도 한정 이름으로 낸다', () => {
    const posts: TableDef = {
      ...tbl('posts', [['author_id', 'accounts']]),
      id: 'public.posts',
      schema: 'public',
      constraints: tbl('posts', [['author_id', 'accounts']]).constraints.map((k) =>
        k.kind === 'fk' ? { ...k, refSchema: 'auth' } : k
      )
    }
    const sql = generateSchemaScript([posts, scoped('auth', 'accounts')], 'postgresql')
    expect(sql).toContain('REFERENCES "auth"."accounts"')
  })
})
