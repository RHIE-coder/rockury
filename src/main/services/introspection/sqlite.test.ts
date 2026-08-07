import { describe, expect, it } from 'vitest'
import { parseSqliteChecks } from './sqlite'

/**
 * SQLite 의 CHECK 는 PRAGMA 가 안 알려 준다 — sqlite_master 의 CREATE 문이 유일한 출처라
 * 그 글자를 읽는 일이 곧 정확도다.
 */
describe('parseSqliteChecks', () => {
  it('표 끝에 붙은 이름 있는 CHECK 를 읽는다', () => {
    const sql = ['CREATE TABLE items (', '  price INTEGER,', '  CONSTRAINT chk_price CHECK (price > 0)', ')'].join('\n')
    expect(parseSqliteChecks('main', 'items', sql)).toEqual([
      { schema: 'main', table: 'items', name: 'chk_price', expression: 'price > 0' }
    ])
  })

  it('컬럼 정의 안에 붙은 CHECK 도 읽는다 — 줄 앞에 앵커를 걸면 이걸 놓친다', () => {
    const sql = 'CREATE TABLE items (\n  qty INTEGER NOT NULL CHECK (qty >= 0),\n  name TEXT\n)'
    const [c] = parseSqliteChecks('main', 'items', sql)
    expect([c.name, c.expression]).toEqual(['items_check_1', 'qty >= 0'])
  })

  it('여러 개면 순서대로 번호를 매긴다', () => {
    const sql = 'CREATE TABLE t (a INT CHECK (a > 0), b INT CHECK (b < 10))'
    expect(parseSqliteChecks('main', 't', sql).map((c) => [c.name, c.expression])).toEqual([
      ['t_check_1', 'a > 0'],
      ['t_check_2', 'b < 10']
    ])
  })

  it('문자열 안의 CHECK 는 제약이 아니다', () => {
    const sql = "CREATE TABLE t (a TEXT DEFAULT 'CHECK (x > 0)')"
    expect(parseSqliteChecks('main', 't', sql)).toEqual([])
  })

  it('식 안의 닫는 괄호가 글자여도 끝까지 읽는다', () => {
    const sql = "CREATE TABLE t (s TEXT CHECK (s <> ')'))"
    expect(parseSqliteChecks('main', 't', sql)[0].expression).toBe("s <> ')'")
  })

  it('큰따옴표로 인용한 이름을 벗긴다', () => {
    const sql = 'CREATE TABLE t (a INT, CONSTRAINT "chk a" CHECK (a > 0))'
    expect(parseSqliteChecks('main', 't', sql)[0].name).toBe('chk a')
  })

  it('CREATE 문이 없으면(뷰 등) 빈 목록', () => {
    expect(parseSqliteChecks('main', 'v', '')).toEqual([])
  })
})
