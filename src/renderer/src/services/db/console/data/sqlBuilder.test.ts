import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  canEdit,
  pkColumns,
  quoteIdent
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

describe('buildSelect', () => {
  it('LIMIT/OFFSET 정수 인라인 + ORDER BY', () => {
    expect(buildSelect('postgresql', 'users', { limit: 25, offset: 50 })).toBe(
      'SELECT * FROM "users" LIMIT 25 OFFSET 50'
    )
    expect(
      buildSelect('mysql', 'users', { limit: 10, offset: 0, orderBy: { column: 'id', direction: 'DESC' } })
    ).toBe('SELECT * FROM `users` ORDER BY `id` DESC LIMIT 10 OFFSET 0')
  })
  it('음수/비정상 limit 은 0 으로 정제', () => {
    expect(buildSelect('sqlite', 't', { limit: -5, offset: NaN })).toBe(
      'SELECT * FROM "t" LIMIT 0 OFFSET 0'
    )
  })
})

describe('buildInsert', () => {
  it('pg 는 $n 플레이스홀더 + 값은 params 로 분리', () => {
    const s = buildInsert('postgresql', 'users', { id: 1, email: 'a@b.c' })
    expect(s.sql).toBe('INSERT INTO "users" ("id", "email") VALUES ($1, $2)')
    expect(s.params).toEqual([1, 'a@b.c'])
  })
  it('mysql 은 ? 플레이스홀더', () => {
    const s = buildInsert('mysql', 'users', { id: 1, email: 'a@b.c' })
    expect(s.sql).toBe('INSERT INTO `users` (`id`, `email`) VALUES (?, ?)')
    expect(s.params).toEqual([1, 'a@b.c'])
  })
  it('빈 값이면 throw', () => {
    expect(() => buildInsert('mysql', 't', {})).toThrow()
  })
})

describe('buildUpdate', () => {
  it('SET → WHERE 순서로 params, pg $n 연속 증가', () => {
    const s = buildUpdate('postgresql', 'users', ['id'], { id: 7 }, { email: 'x@y.z', age: 30 })
    expect(s.sql).toBe('UPDATE "users" SET "email" = $1, "age" = $2 WHERE "id" = $3')
    expect(s.params).toEqual(['x@y.z', 30, 7])
  })
  it('복합 PK WHERE 연결(mysql ?)', () => {
    const s = buildUpdate('mysql', 'user_roles', ['user_id', 'role_id'], { user_id: 'u', role_id: 'r' }, { note: 'n' })
    expect(s.sql).toBe('UPDATE `user_roles` SET `note` = ? WHERE `user_id` = ? AND `role_id` = ?')
    expect(s.params).toEqual(['n', 'u', 'r'])
  })
  it('변경/PK 없으면 throw', () => {
    expect(() => buildUpdate('mysql', 't', ['id'], { id: 1 }, {})).toThrow()
    expect(() => buildUpdate('mysql', 't', [], {}, { a: 1 })).toThrow()
  })
})

describe('buildDelete', () => {
  it('PK WHERE + params', () => {
    const s = buildDelete('postgresql', 'users', ['id'], { id: 9 })
    expect(s.sql).toBe('DELETE FROM "users" WHERE "id" = $1')
    expect(s.params).toEqual([9])
  })
  it('PK 없으면 throw(안전)', () => {
    expect(() => buildDelete('mysql', 't', [], {})).toThrow()
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
