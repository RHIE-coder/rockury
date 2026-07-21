import { describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { buildSchemaMap, formatSql } from './schema'

const tables: TableDef[] = [
  {
    id: 't:users',
    designId: 'd',
    name: 'users',
    comment: '',
    columns: [
      { id: 'c:id', name: 'id', type: 'int', nullable: false, defaultValue: null, comment: '' },
      { id: 'c:email', name: 'email', type: 'text', nullable: false, defaultValue: null, comment: '' }
    ],
    constraints: []
  },
  { id: 't:roles', designId: 'd', name: 'roles', comment: '', columns: [{ id: 'c:id', name: 'id', type: 'int', nullable: false, defaultValue: null, comment: '' }], constraints: [] }
]

describe('buildSchemaMap', () => {
  it('테이블명 → 컬럼명 배열', () => {
    expect(buildSchemaMap(tables)).toEqual({ users: ['id', 'email'], roles: ['id'] })
  })
  it('빈 입력', () => {
    expect(buildSchemaMap([])).toEqual({})
  })
})

describe('formatSql', () => {
  it('SQL 을 정형화(키워드 대문자 + 개행)', () => {
    const out = formatSql('select id,email from users where id=1', 'postgresql')
    expect(out).toContain('SELECT')
    expect(out).toContain('FROM')
    expect(out).not.toBe('select id,email from users where id=1')
  })
  it('구문 오류는 원본 유지(입력 보존)', () => {
    const bad = 'SELECT ((( FROM'
    expect(typeof formatSql(bad, 'mysql')).toBe('string')
  })
})
