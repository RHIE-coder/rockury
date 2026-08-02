import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  canEdit,
  pkColumns,
  quoteIdent,
  quoteTable
} from './sqlBuilder'

describe('quoteIdent', () => {
  it('방언별 인용 부호', () => {
    expect(quoteIdent('mysql', 'a')).toBe('`a`')
    expect(quoteIdent('mariadb', 'a')).toBe('`a`')
    expect(quoteIdent('postgresql', 'a')).toBe('"a"')
    expect(quoteIdent('sqlite', 'a')).toBe('"a"')
  })
  it('내부 인용 부호 이스케이프', () => {
    expect(quoteIdent('postgresql', 'a"b')).toBe('"a""b"')
    expect(quoteIdent('mysql', 'a`b')).toBe('`a``b`')
  })
})

describe('quoteTable', () => {
  it('스키마를 알면 한정한다', () => {
    expect(quoteTable('mysql', { schema: 'service1', name: 'customers' })).toBe('`service1`.`customers`')
    expect(quoteTable('postgresql', { schema: 'auth', name: 'users' })).toBe('"auth"."users"')
  })
  it('스키마를 모르면 이름만 — 연결의 기본 스키마에 맡긴다', () => {
    expect(quoteTable('mysql', { name: 'customers' })).toBe('`customers`')
    expect(quoteTable('sqlite', { name: 't' })).toBe('"t"')
  })
  it('스키마 이름도 이스케이프한다', () => {
    expect(quoteTable('postgresql', { schema: 'a"b', name: 'c' })).toBe('"a""b"."c"')
  })
})

/**
 * 회귀: 범위(scope)로 다른 스키마를 보는 중에 이름만 넣으면 연결의 기본 스키마에서 찾는다.
 * 2026-08-01 화면 피드백 — MySQL 범위를 `service1` 로 두고 표를 열었더니
 * `Table 'testdb.customers' doesn't exist`(testdb = 연결이 처음 붙은 database).
 */
describe('범위 밖 스키마의 테이블 — 네 문 모두 한정 이름을 쓴다', () => {
  const customers = { schema: 'service1', name: 'customers' }
  it('SELECT', () => {
    expect(buildSelect('mysql', customers, { limit: 50, offset: 0 }).sql).toBe(
      'SELECT * FROM `service1`.`customers` LIMIT 50 OFFSET 0'
    )
  })
  it('INSERT', () => {
    expect(buildInsert('mysql', customers, { id: 1 }).sql).toBe(
      'INSERT INTO `service1`.`customers` (`id`) VALUES (?)'
    )
  })
  it('UPDATE', () => {
    expect(buildUpdate('mysql', customers, ['id'], { id: 1 }, { name: 'n' }).sql).toBe(
      'UPDATE `service1`.`customers` SET `name` = ? WHERE `id` = ?'
    )
  })
  it('DELETE', () => {
    expect(buildDelete('mysql', customers, ['id'], { id: 1 }).sql).toBe(
      'DELETE FROM `service1`.`customers` WHERE `id` = ?'
    )
  })
})

describe('buildSelect', () => {
  it('LIMIT/OFFSET 정수 인라인 + ORDER BY', () => {
    expect(buildSelect('postgresql', { name: 'users' }, { limit: 25, offset: 50 })).toEqual({
      sql: 'SELECT * FROM "users" LIMIT 25 OFFSET 50',
      params: []
    })
    expect(
      buildSelect('mysql', { name: 'users' }, { limit: 10, offset: 0, orderBy: { column: 'id', direction: 'DESC' } }).sql
    ).toBe('SELECT * FROM `users` ORDER BY `id` DESC LIMIT 10 OFFSET 0')
  })
  it('음수/비정상 limit 은 0 으로 정제', () => {
    expect(buildSelect('sqlite', { name: 't' }, { limit: -5, offset: NaN }).sql).toBe('SELECT * FROM "t" LIMIT 0 OFFSET 0')
  })
  it('필터는 파라미터 바인드 WHERE (pg $n)', () => {
    const s = buildSelect('postgresql', { name: 'users' }, {
      limit: 50,
      offset: 0,
      filters: [
        { column: 'email', op: 'LIKE', value: '%a%' },
        { column: 'age', op: '>', value: '18' },
        { column: 'deleted_at', op: 'IS NULL', value: '' }
      ]
    })
    expect(s.sql).toBe('SELECT * FROM "users" WHERE "email" LIKE $1 AND "age" > $2 AND "deleted_at" IS NULL LIMIT 50 OFFSET 0')
    expect(s.params).toEqual(['%a%', '18'])
  })
  it('빈 값 필터는 무시(IS NULL 제외)', () => {
    const s = buildSelect('mysql', { name: 't' }, { limit: 50, offset: 0, filters: [{ column: 'a', op: '=', value: '' }] })
    expect(s.sql).toBe('SELECT * FROM `t` LIMIT 50 OFFSET 0')
    expect(s.params).toEqual([])
  })
})

describe('buildInsert', () => {
  it('pg 는 $n 플레이스홀더 + 값은 params 로 분리', () => {
    const s = buildInsert('postgresql', { name: 'users' }, { id: 1, email: 'a@b.c' })
    expect(s.sql).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2)')
    expect(s.params).toEqual([1, 'a@b.c'])
  })
  it('mysql 은 ? 플레이스홀더', () => {
    const s = buildInsert('mysql', { name: 'users' }, { id: 1, email: 'a@b.c' })
    expect(s.sql).toBe('INSERT INTO `users` (`id`, `email`) VALUES (?, ?)')
    expect(s.params).toEqual([1, 'a@b.c'])
  })
  it('빈 값이면 throw', () => {
    expect(() => buildInsert('mysql', { name: 't' }, {})).toThrow()
  })
})

describe('buildUpdate', () => {
  it('SET → WHERE 순서로 params, pg $n 연속 증가', () => {
    const s = buildUpdate('postgresql', { name: 'users' }, ['id'], { id: 7 }, { email: 'x@y.z', age: 30 })
    expect(s.sql).toBe('UPDATE "users" SET "email" = $1, "age" = $2 WHERE "id" = $3')
    expect(s.params).toEqual(['x@y.z', 30, 7])
  })
  it('복합 PK WHERE 연결(mysql ?)', () => {
    const s = buildUpdate('mysql', { name: 'user_roles' }, ['user_id', 'role_id'], { user_id: 'u', role_id: 'r' }, { note: 'n' })
    expect(s.sql).toBe('UPDATE `user_roles` SET `note` = ? WHERE `user_id` = ? AND `role_id` = ?')
    expect(s.params).toEqual(['n', 'u', 'r'])
  })
  it('변경/PK 없으면 throw', () => {
    expect(() => buildUpdate('mysql', { name: 't' }, ['id'], { id: 1 }, {})).toThrow()
    expect(() => buildUpdate('mysql', { name: 't' }, [], {}, { a: 1 })).toThrow()
  })
})

describe('buildDelete', () => {
  it('PK WHERE + params', () => {
    const s = buildDelete('postgresql', { name: 'users' }, ['id'], { id: 9 })
    expect(s.sql).toBe('DELETE FROM "users" WHERE "id" = $1')
    expect(s.params).toEqual([9])
  })
  it('PK 없으면 throw(안전)', () => {
    expect(() => buildDelete('mysql', { name: 't' }, [], {})).toThrow()
  })
})

const tableWithPk: TableDef = {
  id: 't:user_roles',
  designId: 'd',
  name: 'user_roles',
  comment: '',
  columns: [
    { id: 'c:user_roles.user_id', name: 'user_id', type: 'char(36)', nullable: false, defaultValue: null, comment: '' },
    { id: 'c:user_roles.role_id', name: 'role_id', type: 'char(36)', nullable: false, defaultValue: null, comment: '' }
  ],
  constraints: [
    {
      id: 'k:user_roles.PRIMARY',
      kind: 'pk',
      name: 'PRIMARY',
      columns: [{ columnId: 'c:user_roles.user_id' }, { columnId: 'c:user_roles.role_id' }]
    }
  ]
}

const tableNoPk: TableDef = {
  id: 't:logs',
  designId: 'd',
  name: 'logs',
  comment: '',
  columns: [{ id: 'c:logs.msg', name: 'msg', type: 'text', nullable: true, defaultValue: null, comment: '' }],
  constraints: []
}

describe('pkColumns / canEdit', () => {
  it('PK 컬럼명을 순서대로 해석', () => {
    expect(pkColumns(tableWithPk)).toEqual(['user_id', 'role_id'])
  })
  it('PK 있으면 편집 가능, 없으면 읽기전용', () => {
    expect(canEdit(tableWithPk)).toBe(true)
    expect(canEdit(tableNoPk)).toBe(false)
    expect(pkColumns(tableNoPk)).toEqual([])
  })
})
