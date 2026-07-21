import { describe, expect, it } from 'vitest'
import { DEFAULT_PORTS, defaultPort, isFileBased, validateConnForm, type ConnFormValues } from './validate'

const base: ConnFormValues = {
  name: 'prod-db',
  dbType: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'test'
}

describe('defaultPort / DEFAULT_PORTS', () => {
  it('벤더별 기본 포트', () => {
    expect(defaultPort('postgresql')).toBe(5432)
    expect(defaultPort('mysql')).toBe(3306)
    expect(defaultPort('mariadb')).toBe(3306)
    expect(defaultPort('sqlite')).toBe(0)
  })
  it('모든 방언에 항목', () => {
    expect(Object.keys(DEFAULT_PORTS).sort()).toEqual(['mariadb', 'mysql', 'postgresql', 'sqlite'])
  })
})

describe('isFileBased', () => {
  it('sqlite 만 파일 기반', () => {
    expect(isFileBased('sqlite')).toBe(true)
    expect(isFileBased('mysql')).toBe(false)
  })
})

describe('validateConnForm', () => {
  it('완전한 네트워크 폼 통과', () => {
    expect(validateConnForm(base).ok).toBe(true)
  })
  it('이름 필수', () => {
    expect(validateConnForm({ ...base, name: '  ' }).errors.name).toBeDefined()
  })
  it('네트워크 벤더는 host/database/user 필수', () => {
    const r = validateConnForm({ ...base, host: '', database: '', user: '' })
    expect(r.errors.host).toBeDefined()
    expect(r.errors.database).toBeDefined()
    expect(r.errors.user).toBeDefined()
  })
  it('포트 범위', () => {
    expect(validateConnForm({ ...base, port: 0 }).errors.port).toBeDefined()
    expect(validateConnForm({ ...base, port: 70000 }).errors.port).toBeDefined()
    expect(validateConnForm({ ...base, port: 5432 }).errors.port).toBeUndefined()
  })
  it('sqlite 는 파일 경로만 필수 (설계 결합 없음 — dbType 자유)', () => {
    expect(
      validateConnForm({ name: 'local', dbType: 'sqlite', host: '', port: 0, database: '/tmp/x.sqlite', user: '' }).ok
    ).toBe(true)
    expect(
      validateConnForm({ name: 'local', dbType: 'sqlite', host: '', port: 0, database: '', user: '' }).errors.database
    ).toBeDefined()
  })
})
