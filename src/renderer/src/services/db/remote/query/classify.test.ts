import { describe, expect, it } from 'vitest'
import { allReadOnly, classifyScript, classifyStatement, hasDdl, splitSql, stripLeadingComments } from './classify'

describe('allReadOnly', () => {
  it('전부 SELECT 면 true', () => {
    expect(allReadOnly(['SELECT 1', 'SELECT * FROM t'])).toBe(true)
  })
  it('하나라도 DML/DDL 이면 false', () => {
    expect(allReadOnly(['SELECT 1', 'UPDATE t SET a=1 WHERE id=1'])).toBe(false)
    expect(allReadOnly(['SELECT 1', 'CREATE TABLE t (id int)'])).toBe(false)
  })
  it('빈 문/주석만 있는 문은 읽기로 간주(무시)', () => {
    expect(allReadOnly(['SELECT 1', '-- comment', ''])).toBe(true)
  })
  it('빈 배열은 true', () => {
    expect(allReadOnly([])).toBe(true)
  })
})

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

describe('splitSql — 문 분리(인용/주석 내 ; 무시)', () => {
  it('세미콜론으로 나눈다', () => {
    expect(splitSql('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('문자열 안의 ; 는 나누지 않는다', () => {
    expect(splitSql("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT 1'])
  })
  it("작은따옴표 '' 이스케이프를 문자열 종료로 오인하지 않는다", () => {
    expect(splitSql("SELECT 'O''Brien; x'; SELECT 2")).toEqual(["SELECT 'O''Brien; x'", 'SELECT 2'])
  })
  it('라인/블록 주석 안의 ; 는 무시', () => {
    expect(splitSql('SELECT 1 -- ; nope\n; SELECT 2')).toEqual(['SELECT 1 -- ; nope', 'SELECT 2'])
    expect(splitSql('SELECT 1 /* ; nope */; SELECT 2')).toEqual(['SELECT 1 /* ; nope */', 'SELECT 2'])
  })
  it('후행 세미콜론/빈 문은 버린다', () => {
    expect(splitSql('SELECT 1;')).toEqual(['SELECT 1'])
    expect(splitSql('SELECT 1;;')).toEqual(['SELECT 1'])
  })
})

describe('classifyScript — 스크립트 전체 판정(라우팅 안전)', () => {
  it('단일 문은 classifyStatement 와 동일', () => {
    expect(classifyScript('SELECT * FROM t')).toEqual(classifyStatement('SELECT * FROM t'))
    expect(classifyScript('UPDATE t SET a=1')).toEqual(classifyStatement('UPDATE t SET a=1'))
  })
  it('⭐ 첫 문이 SELECT 라도 뒤에 DML 이 있으면 전체를 dml 로(게이트 강제)', () => {
    const c = classifyScript('SELECT 1; DELETE FROM users')
    expect(c.kind).toBe('dml')
    expect(c.destructive).toBe(true) // WHERE 없는 DELETE 포함
  })
  it('전부 읽기면 read', () => {
    expect(classifyScript('SELECT 1; SELECT 2').kind).toBe('read')
  })
  it('DDL+DML 섞이면 dml(게이트 우선)', () => {
    expect(classifyScript('CREATE TABLE t (id int); INSERT INTO t VALUES (1)').kind).toBe('dml')
  })
  it('DDL 만 여럿이면 ddl', () => {
    expect(classifyScript('CREATE TABLE a (id int); CREATE TABLE b (id int)').kind).toBe('ddl')
  })
  it('빈/주석뿐이면 empty', () => {
    expect(classifyScript('  ; -- x\n ; /* y */ ').kind).toBe('empty')
  })
})

describe('hasDdl — 실행 뒤 역설계를 다시 읽어야 하나', () => {
  it('DDL 한 문이면 true', () => {
    expect(hasDdl('ALTER TABLE t RENAME TO u')).toBe(true)
  })
  it('⭐ DML 에 섞여 있어도 찾아낸다 — classifyScript 는 dml 로 접어 버린다', () => {
    const sql = 'ALTER TABLE t ADD COLUMN c text; UPDATE t SET c = 1'
    expect(classifyScript(sql).kind).toBe('dml')
    expect(hasDdl(sql)).toBe(true)
  })
  it('읽기·DML 뿐이면 false', () => {
    expect(hasDdl('SELECT 1; UPDATE t SET a=1 WHERE id=1')).toBe(false)
  })
  it('주석에 가려진 DDL 도 찾아낸다 — 선행 주석은 판정에서 걷힌다', () => {
    expect(hasDdl('-- 표를 만든다\nCREATE TABLE t (id int)')).toBe(true)
  })
  it('문자열 안의 세미콜론·DDL 낱말에는 안 속는다', () => {
    expect(hasDdl("SELECT 'DROP TABLE t; ' AS s")).toBe(false)
  })
  it('빈 문/주석뿐이면 false', () => {
    expect(hasDdl('  ; -- x\n ; /* y */ ')).toBe(false)
  })
})

