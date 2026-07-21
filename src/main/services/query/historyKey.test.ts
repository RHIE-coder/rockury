import { describe, expect, it } from 'vitest'
import { isSameQuery, normalizeSqlKey } from './historyKey'

describe('normalizeSqlKey', () => {
  it('trim + 공백 정규화', () => {
    expect(normalizeSqlKey('  SELECT   1\n FROM t  ')).toBe('SELECT 1 FROM t')
  })
})

describe('isSameQuery', () => {
  it('공백만 다른 쿼리는 동일 취급', () => {
    expect(isSameQuery('SELECT 1', 'SELECT   1')).toBe(true)
    expect(isSameQuery('SELECT 1', 'SELECT 2')).toBe(false)
  })
})
