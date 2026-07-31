import { describe, expect, it } from 'vitest'
import type { Constraint, TableDef } from '../definition/types'
import { planSeedApply, type SeedApplyInput } from './seedApplyPlan'
import { deterministicUuid, pkSeedString, renderPkTemplate } from './seedPk'
import type { SeedRow, SeedSet } from './types'

/** CASE-design-070~078 (docs/qa/db-design.md) */

const col = (id: string, name: string, over: Partial<TableDef['columns'][number]> = {}) => ({
  id,
  name,
  type: 'VARCHAR(64)',
  nullable: true,
  defaultValue: null,
  comment: '',
  ...over
})

const pk = (id: string, colIds: string[]): Constraint => ({
  id,
  kind: 'pk',
  name: 'PRIMARY',
  columns: colIds.map((c) => ({ columnId: c }))
})

const fkCon = (id: string, colId: string, refTable: string): Constraint => ({
  id,
  kind: 'fk',
  name: `fk_${colId}`,
  columns: [{ columnId: colId }],
  refTable,
  refColumns: ['id']
})

const table = (name: string, cols: TableDef['columns'], constraints: Constraint[] = []): TableDef => ({
  id: `t:${name}`,
  designId: 'd1',
  name,
  comment: '',
  columns: cols,
  constraints
})

const row = (id: string, alias: string | undefined, values: Record<string, string | null>): SeedRow => ({
  id,
  alias,
  values
})

const set = (tableName: string, rows: SeedRow[], over: Partial<SeedSet> = {}): SeedSet => ({
  designId: 'd1',
  tableName,
  naturalKey: ['code'],
  ignoredColumns: [],
  strength: 'ensure',
  rows,
  ...over
})

// users(id AUTO_INCREMENT PK, code, name)
const usersTable = table(
  'users',
  [col('c1', 'id', { defaultValue: 'AUTO_INCREMENT', nullable: false }), col('c2', 'code'), col('c3', 'name')],
  [pk('k1', ['c1'])]
)

const plan = (over: Partial<SeedApplyInput>) =>
  planSeedApply({
    sets: [],
    tables: [usersTable],
    dialect: 'mysql',
    current: {},
    variables: {},
    ...over
  })

describe('CASE-design-070 없는 행은 넣는다', () => {
  it('INSERT 문을 파라미터 바인드로 만든다(문자열 조립 금지)', () => {
    const p = plan({ sets: [set('users', [row('r1', 'admin', { code: 'admin', name: '관리자' })])] })
    expect(p.blockers).toEqual([])
    expect(p.summary).toMatchObject({ inserts: 1, updates: 0, unchanged: 0 })
    expect(p.steps[0].kind).toBe('insert')
    expect(p.steps[0].statement.sql).toContain('INSERT INTO `users`')
    expect(p.steps[0].statement.sql).not.toContain('관리자') // 값은 파라미터로
    expect(p.steps[0].statement.params).toEqual(['admin', '관리자'])
  })

  it('PK 가 DB 생성이면 INSERT 에 PK 를 담지 않는다', () => {
    const p = plan({ sets: [set('users', [row('r1', undefined, { code: 'admin', id: '999' })])] })
    expect(p.steps[0].statement.sql).not.toContain('`id`')
  })
})

describe('CASE-design-071 있는 행은 값만 맞춘다', () => {
  it('다른 값만 UPDATE 하고 WHERE 는 짝짓기 기준이다(PK 가 아니다)', () => {
    const p = plan({
      sets: [set('users', [row('r1', 'admin', { code: 'admin', name: '최고 관리자' })])],
      current: { users: [{ id: 7, code: 'admin', name: '관리자' }] }
    })
    expect(p.blockers).toEqual([])
    expect(p.summary).toMatchObject({ inserts: 0, updates: 1 })
    expect(p.steps[0].changedColumns).toEqual(['name'])
    expect(p.steps[0].statement.sql).toBe('UPDATE `users` SET `name` = ? WHERE `code` = ?')
    expect(p.steps[0].statement.params).toEqual(['최고 관리자', 'admin'])
  })

  it('값이 같으면 아무 문장도 만들지 않는다', () => {
    const p = plan({
      sets: [set('users', [row('r1', 'admin', { code: 'admin', name: '관리자' })])],
      current: { users: [{ id: 7, code: 'admin', name: '관리자' }] }
    })
    expect(p.steps).toEqual([])
    expect(p.summary.unchanged).toBe(1)
  })

  it('무시 컬럼은 UPDATE 대상이 아니다', () => {
    const p = plan({
      sets: [
        set('users', [row('r1', 'admin', { code: 'admin', name: '관리자' })], { ignoredColumns: ['name'] })
      ],
      current: { users: [{ id: 7, code: 'admin', name: '옛 이름' }] }
    })
    expect(p.steps).toEqual([])
  })

  it('DB 가 숫자로 돌려준 값도 문자열 시드 값과 같게 본다', () => {
    const p = plan({
      sets: [set('users', [row('r1', undefined, { code: '100', name: 'x' })], { naturalKey: ['code'] })],
      current: { users: [{ id: 7, code: 100, name: 'x' }] }
    })
    expect(p.summary.unchanged).toBe(1)
  })
})

describe('CASE-design-072 변수 치환', () => {
  const usersWithPw = table(
    'users',
    [col('c1', 'id', { defaultValue: 'AUTO_INCREMENT' }), col('c2', 'code'), col('c3', 'pw')],
    [pk('k1', ['c1'])]
  )

  it('환경 변수 값으로 치환한다', () => {
    const p = planSeedApply({
      sets: [set('users', [row('r1', undefined, { code: 'admin', pw: '{{ADMIN_PW}}' })])],
      tables: [usersWithPw],
      dialect: 'mysql',
      current: {},
      variables: { ADMIN_PW: 'hashed!' }
    })
    expect(p.blockers).toEqual([])
    expect(p.steps[0].statement.params).toContain('hashed!')
  })

  it('값이 없으면 막는다 — 반쯤 심고 마는 상태를 만들지 않는다', () => {
    const p = planSeedApply({
      sets: [set('users', [row('r1', undefined, { code: 'admin', pw: '{{ADMIN_PW}}' })])],
      tables: [usersWithPw],
      dialect: 'mysql',
      current: {},
      variables: {}
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'missing-variable' })
    expect(p.steps).toEqual([])
  })
})

describe('CASE-design-073 참조 해석', () => {
  const profilesTable = table(
    'user_profiles',
    [col('p0', 'id', { defaultValue: 'AUTO_INCREMENT' }), col('p1', 'user_id'), col('p2', 'code')],
    [pk('pk', ['p0']), fkCon('k2', 'p1', 'users')]
  )
  const users = set('users', [row('u1', 'admin', { code: 'admin' })])
  const profiles = set('user_profiles', [row('p1', undefined, { code: 'p-admin', user_id: '@users#admin' })])

  it('대상 행이 실 DB 에 있으면 그 환경의 실제 PK 로 치환한다', () => {
    const p = planSeedApply({
      sets: [users, profiles],
      tables: [usersTable, profilesTable],
      dialect: 'mysql',
      current: { users: [{ id: 412, code: 'admin' }] },
      variables: {}
    })
    expect(p.blockers).toEqual([])
    const insert = p.steps.find((s) => s.table === 'user_profiles')!
    expect(insert.statement.params).toContain('412')
  })

  it('대상이 없고 PK 를 DB 가 만들면 막고 무엇을 바꿔야 하는지 알린다', () => {
    const p = planSeedApply({
      sets: [users, profiles],
      tables: [usersTable, profilesTable],
      dialect: 'mysql',
      current: {},
      variables: {}
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'unresolved-ref' })
    expect(p.blockers[0].message).toContain('시드가 정한다')
  })

  it('대상 PK 를 시드가 정하면 아직 없어도 값을 미리 안다', () => {
    const seeded = { ...users, pkStrategy: 'seed' as const, pkTemplate: 'u-{alias}' }
    const p = planSeedApply({
      sets: [seeded, profiles],
      tables: [usersTable, profilesTable],
      dialect: 'mysql',
      current: {},
      variables: {}
    })
    expect(p.blockers).toEqual([])
    const insert = p.steps.find((s) => s.table === 'user_profiles')!
    expect(insert.statement.params).toContain('u-admin')
  })

  it('참조 대상 테이블이 먼저 실행된다(위상정렬)', () => {
    const seeded = { ...users, pkStrategy: 'seed' as const, pkTemplate: 'u-{alias}' }
    const p = planSeedApply({
      sets: [profiles, seeded], // 일부러 거꾸로 넣는다
      tables: [usersTable, profilesTable],
      dialect: 'mysql',
      current: {},
      variables: {}
    })
    expect(p.steps.map((s) => s.table)).toEqual(['users', 'user_profiles'])
  })

  it('순환 참조는 막는다', () => {
    const a = set('users', [row('u1', 'one', { code: 'a', name: '@user_profiles#two' })])
    const b = set('user_profiles', [row('p1', 'two', { code: 'b', user_id: '@users#one' })])
    const p = planSeedApply({
      sets: [a, b],
      tables: [usersTable, profilesTable],
      dialect: 'mysql',
      current: {},
      variables: {}
    })
    expect(p.blockers.some((b2) => b2.kind === 'cycle')).toBe(true)
  })
})

describe('CASE-design-074 PK 방어선', () => {
  const seededUsers = (rows: SeedRow[]) =>
    set('users', rows, { pkStrategy: 'seed', pkTemplate: 'u-{alias}' })

  it('시드가 정한 PK 를 이미 다른 행이 쓰고 있으면 멈춘다', () => {
    const p = plan({
      sets: [seededUsers([row('r1', 'admin', { code: 'admin' })])],
      current: { users: [{ id: 'u-admin', code: 'someone-else' }] }
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'pk-conflict' })
    expect(p.steps).toEqual([])
  })

  it('이미 있는 행의 PK 가 설계와 달라도 바꾸지 않고 알린다', () => {
    const p = plan({
      sets: [seededUsers([row('r1', 'admin', { code: 'admin', name: '관리자' })])],
      current: { users: [{ id: 412, code: 'admin', name: '관리자' }] }
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'pk-conflict' })
    expect(p.blockers[0].message).toContain('FK')
    expect(p.steps.every((s) => !s.statement.sql.includes('`id`'))).toBe(true)
  })

  it('PK 를 시드가 정하기로 했는데 값도 규칙도 없으면 막는다', () => {
    const p = plan({ sets: [set('users', [row('r1', undefined, { code: 'admin' })], { pkStrategy: 'seed' })] })
    expect(p.blockers[0]).toMatchObject({ kind: 'no-pk-value' })
  })

  // 실 DB 와의 충돌만 보면 이건 안 잡힌다 — 계획은 통과했다가 반영 트랜잭션에서 터진다.
  it('상수 규칙이면 시드 행끼리 같은 PK 가 되는 것을 막는다', () => {
    const p = plan({
      sets: [
        set('users', [row('r1', 'admin', { code: 'admin' }), row('r2', 'member', { code: 'member' })], {
          pkStrategy: 'seed',
          pkTemplate: 'u-fixed'
        })
      ]
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'pk-conflict' })
    expect(p.blockers[0].message).toContain('시드의 다른 행')
    // 겹친 행만 빠지고 첫 행은 그대로 들어간다.
    expect(p.steps).toHaveLength(1)
  })

  it('셀에 같은 PK 값을 손으로 두 번 써도 막는다(규칙 없이도)', () => {
    const p = plan({
      sets: [
        set('users', [row('r1', undefined, { code: 'a', id: 'same' }), row('r2', undefined, { code: 'b', id: 'same' })], {
          pkStrategy: 'seed'
        })
      ]
    })
    expect(p.blockers[0]).toMatchObject({ kind: 'pk-conflict' })
  })

  it('행마다 달라지는 규칙이면 막지 않는다 — 오탐 없음', () => {
    const p = plan({
      sets: [seededUsers([row('r1', 'admin', { code: 'admin' }), row('r2', 'member', { code: 'member' })])]
    })
    expect(p.blockers).toEqual([])
    expect(p.steps).toHaveLength(2)
  })
})

describe('CASE-design-075 삭제 후보(전권)', () => {
  it('전권 세트에서 실 DB 에만 있는 행을 삭제 후보로 만든다', () => {
    const p = plan({
      sets: [set('users', [row('r1', undefined, { code: 'admin' })], { strength: 'authoritative' })],
      current: { users: [{ id: 1, code: 'admin' }, { id: 2, code: 'temp' }] }
    })
    const del = p.steps.find((s) => s.kind === 'delete-candidate')!
    expect(del.label).toBe('temp')
    expect(del.statement.sql).toBe('DELETE FROM `users` WHERE `code` = ?')
    expect(p.summary.deleteCandidates).toBe(1)
  })

  it('보장만 세트는 삭제 후보를 만들지 않는다', () => {
    const p = plan({
      sets: [set('users', [row('r1', undefined, { code: 'admin' })])],
      current: { users: [{ id: 2, code: 'temp' }] }
    })
    expect(p.steps.some((s) => s.kind === 'delete-candidate')).toBe(false)
  })
})

describe('CASE-design-076 반영 전제 미충족', () => {
  it('짝짓기 기준이 없으면 막는다', () => {
    const p = plan({ sets: [set('users', [row('r1', undefined, { code: 'a' })], { naturalKey: [] })] })
    expect(p.blockers[0]).toMatchObject({ kind: 'not-ready' })
    expect(p.steps).toEqual([])
  })

  it('짝짓기 기준 값이 비면 그 행을 막는다', () => {
    const p = plan({ sets: [set('users', [row('r1', undefined, { code: '  ' })])] })
    expect(p.blockers[0]).toMatchObject({ kind: 'row-invalid' })
  })
})

describe('CASE-design-077 결정적 PK 생성', () => {
  it('같은 입력이면 항상 같은 UUID — 재실행해도 값이 안 바뀐다', () => {
    expect(deterministicUuid('d1:users:admin')).toBe(deterministicUuid('d1:users:admin'))
    expect(deterministicUuid('d1:users:admin')).not.toBe(deterministicUuid('d1:users:viewer'))
  })

  it('UUID 형태를 지킨다(버전 자리는 8 — 랜덤 v4 와 구별)', () => {
    expect(deterministicUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('씨앗은 설계·테이블·행 정체성으로 만든다 — 다른 설계와 겹치지 않는다', () => {
    const s = { designId: 'd1', tableName: 'users', naturalKey: ['code'] }
    expect(pkSeedString(s, row('r', 'admin', { code: 'admin' }))).toBe('d1:users:admin')
    expect(pkSeedString({ ...s, designId: 'd2' }, row('r', 'admin', { code: 'admin' }))).toBe('d2:users:admin')
  })

  it('템플릿 자리표시자를 펼친다 — 모르는 자리표시자는 남겨 눈에 띄게 한다', () => {
    const s = { designId: 'd1', tableName: 'users', naturalKey: ['org', 'code'] }
    const r = row('r', 'admin', { org: 'acme', code: 'boss' })
    expect(renderPkTemplate('{table}-{alias}', s, r)).toBe('users-admin')
    expect(renderPkTemplate('k:{key}', s, r)).toBe('k:acme-boss')
    expect(renderPkTemplate('{uuid}', s, r)).toBe(deterministicUuid('d1:users:admin'))
    expect(renderPkTemplate('{nope}', s, r)).toBe('{nope}')
  })
})
