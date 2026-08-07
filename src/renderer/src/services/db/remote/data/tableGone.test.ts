import { describe, expect, it } from 'vitest'
import { isTableMissingError } from './tableGone'

/**
 * CASE-remote-06A — "그 표 없음" 오류만 골라낸다(§db-remote.data.saved-filter AC-5).
 *
 * 이 함수가 틀리면 사용자가 만든 저장 필터가 **되돌릴 수 없이** 사라진다. 그래서 판정은
 * "없다고 확실히 말한 경우"만 참이고, 나머지는 전부 거짓이다(모르면 안 지운다).
 */
describe('isTableMissingError — DB 가 "그 표 없다"고 말했나', () => {
  it('MySQL / MariaDB', () => {
    expect(isTableMissingError("Table 'testdb.gone' doesn't exist")).toBe(true)
    expect(isTableMissingError('ER_NO_SUCH_TABLE: Table testdb.gone does not exist')).toBe(true)
  })

  it('PostgreSQL', () => {
    expect(isTableMissingError('relation "public.gone" does not exist')).toBe(true)
    expect(isTableMissingError('error: relation "gone" does not exist (42P01)')).toBe(true)
    expect(isTableMissingError('undefined_table')).toBe(true)
  })

  it('SQLite', () => {
    expect(isTableMissingError('SQLITE_ERROR: no such table: gone')).toBe(true)
  })

  it('권한 문제는 "없음"이 아니다 — 표는 거기 있다', () => {
    // 이걸 없음으로 읽으면 계정 권한이 잠깐 바뀐 사이 멀쩡한 필터가 날아간다.
    expect(isTableMissingError("SELECT command denied to user 'app'@'%' for table 'orders'")).toBe(false)
    expect(isTableMissingError('permission denied for table orders')).toBe(false)
    expect(isTableMissingError('ER_TABLEACCESS_DENIED_ERROR')).toBe(false)
    expect(isTableMissingError('insufficient privilege')).toBe(false)
  })

  it('접속 문제도 "없음"이 아니다', () => {
    expect(isTableMissingError('connect ECONNREFUSED 127.0.0.1:3306')).toBe(false)
    expect(isTableMissingError('socket hang up')).toBe(false)
    expect(isTableMissingError('Query read timeout')).toBe(false)
  })

  it('데이터베이스·스키마가 없다는 것은 표가 없다는 말과 다르다', () => {
    // 접속 설정이 틀렸거나 범위가 어긋난 상태다 — 그 안의 표 존재 여부는 아직 모른다.
    expect(isTableMissingError("Unknown database 'testdb'")).toBe(false)
    expect(isTableMissingError('database "app" does not exist')).toBe(false)
    expect(isTableMissingError('schema "auth" does not exist')).toBe(false)
  })

  it('컬럼이 없다는 것도 표가 없다는 말이 아니다', () => {
    expect(isTableMissingError("Unknown column 'nickname' in 'field list'")).toBe(false)
    expect(isTableMissingError('column "nickname" does not exist')).toBe(false)
  })

  it('빈 값·모르는 오류는 안 지운다', () => {
    expect(isTableMissingError('')).toBe(false)
    expect(isTableMissingError(null)).toBe(false)
    expect(isTableMissingError('something went wrong')).toBe(false)
  })
})
