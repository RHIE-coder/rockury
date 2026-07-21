import { describe, expect, it } from 'vitest'
import { DEFAULT_PORTS, defaultPort, isFileBased, validateEnvForm, type EnvFormValues } from './validate'

const base: EnvFormValues = {
  name: 'dev',
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

  it('모든 방언에 항목이 있다', () => {
    expect(Object.keys(DEFAULT_PORTS).sort()).toEqual(
      ['mariadb', 'mysql', 'postgresql', 'sqlite']
    )
  })
})

describe('isFileBased', () => {
  it('sqlite 만 파일 기반', () => {
    expect(isFileBased('sqlite')).toBe(true)
    expect(isFileBased('mysql')).toBe(false)
    expect(isFileBased('postgresql')).toBe(false)
    expect(isFileBased('mariadb')).toBe(false)
  })
})

describe('validateEnvForm', () => {
  it('완전한 네트워크 폼은 통과', () => {
    expect(validateEnvForm(base).ok).toBe(true)
  })

  it('이름이 비면 실패', () => {
    const r = validateEnvForm({ ...base, name: '  ' })
    expect(r.ok).toBe(false)
    expect(r.errors.name).toBeDefined()
  })

  it('네트워크 벤더는 host/database/user 필수', () => {
    const r = validateEnvForm({ ...base, host: '', database: '', user: '' })
    expect(r.errors.host).toBeDefined()
    expect(r.errors.database).toBeDefined()
    expect(r.errors.user).toBeDefined()
  })

  it('포트 범위 밖이면 실패', () => {
    expect(validateEnvForm({ ...base, port: 0 }).errors.port).toBeDefined()
    expect(validateEnvForm({ ...base, port: 70000 }).errors.port).toBeDefined()
    expect(validateEnvForm({ ...base, port: 1.5 }).errors.port).toBeDefined()
    expect(validateEnvForm({ ...base, port: 5432 }).errors.port).toBeUndefined()
  })

  it('sqlite 는 파일 경로(database)만 필수 — host/port/user 무시', () => {
    const sqlite: EnvFormValues = {
      name: 'local',
      dbType: 'sqlite',
      host: '',
      port: 0,
      database: '/tmp/x.sqlite',
      user: ''
    }
    expect(validateEnvForm(sqlite).ok).toBe(true)
  })

  it('sqlite 파일 경로가 비면 실패', () => {
    const r = validateEnvForm({
      name: 'local',
      dbType: 'sqlite',
      host: '',
      port: 0,
      database: '',
      user: ''
    })
    expect(r.ok).toBe(false)
    expect(r.errors.database).toBeDefined()
  })

  it('dbType 이 설계 방언과 다르면 실패(벤더 일치 불변식)', () => {
    const r = validateEnvForm(base, { designDialect: 'mysql' })
    expect(r.ok).toBe(false)
    expect(r.errors.dbType).toBeDefined()
  })

  it('dbType 이 설계 방언과 같으면 통과', () => {
    expect(validateEnvForm(base, { designDialect: 'postgresql' }).ok).toBe(true)
  })
})
