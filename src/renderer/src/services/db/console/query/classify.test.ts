import { describe, expect, it } from 'vitest'
import { classifyStatement, stripLeadingComments } from './classify'

describe('stripLeadingComments', () => {
  it('선행 라인/블록 주석과 공백을 제거', () => {
    expect(stripLeadingComments('  -- a\n /* b */\n SELECT 1')).toBe('SELECT 1')
  })
  it('주석만 있으면 빈 문자열', () => {
    expect(stripLeadingComments('-- only\n')).toBe('')
  })
})

describe('classifyStatement', () => {
  it('SELECT/WITH 는 read', () => {
    expect(classifyStatement('SELECT * FROM t').kind).toBe('read')
    expect(classifyStatement('WITH x AS (SELECT 1) SELECT * FROM x').kind).toBe('read')
  })

  it('INSERT/UPDATE/DELETE 는 dml', () => {
    expect(classifyStatement('INSERT INTO t VALUES (1)').kind).toBe('dml')
    expect(classifyStatement('UPDATE t SET a=1 WHERE id=1').kind).toBe('dml')
    expect(classifyStatement('DELETE FROM t WHERE id=1').kind).toBe('dml')
  })

  it('CREATE/ALTER/DROP/TRUNCATE 는 ddl', () => {
    expect(classifyStatement('CREATE TABLE t (id int)').kind).toBe('ddl')
    expect(classifyStatement('ALTER TABLE t ADD c int').kind).toBe('ddl')
    expect(classifyStatement('DROP TABLE t').kind).toBe('ddl')
  })

  it('WHERE 없는 UPDATE/DELETE 는 destructive', () => {
    expect(classifyStatement('UPDATE t SET a=1').destructive).toBe(true)
    expect(classifyStatement('DELETE FROM t').destructive).toBe(true)
  })

  it('WHERE 있는 UPDATE/DELETE 는 non-destructive', () => {
    expect(classifyStatement('UPDATE t SET a=1 WHERE id=1').destructive).toBe(false)
    expect(classifyStatement('DELETE FROM t WHERE id=1').destructive).toBe(false)
  })

  it('DROP/TRUNCATE 는 destructive, INSERT 는 아님', () => {
    expect(classifyStatement('DROP TABLE t').destructive).toBe(true)
    expect(classifyStatement('TRUNCATE TABLE t').destructive).toBe(true)
    expect(classifyStatement('INSERT INTO t VALUES (1)').destructive).toBe(false)
  })

  it('선행 주석을 무시하고 판정 + verb 대문자', () => {
    const c = classifyStatement('-- note\n  drop table t')
    expect(c.kind).toBe('ddl')
    expect(c.verb).toBe('DROP')
  })

  it('빈/주석뿐 → empty', () => {
    expect(classifyStatement('   ').kind).toBe('empty')
    expect(classifyStatement('/* x */').kind).toBe('empty')
  })
})
