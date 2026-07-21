import { describe, expect, it } from 'vitest'
import {
  autoIncrementToken,
  defaultSuggestions,
  isKnownType,
  normalizeBaseType,
  typeSuggestions
} from './typeCatalog'

describe('typeCatalog', () => {
  it('autoIncrementToken per dialect', () => {
    expect(autoIncrementToken('mysql')).toBe('AUTO_INCREMENT')
    expect(autoIncrementToken('mariadb')).toBe('AUTO_INCREMENT')
    expect(autoIncrementToken('postgresql')).toBe('IDENTITY')
    expect(autoIncrementToken('sqlite')).toBe('AUTOINCREMENT')
  })

  it('normalizeBaseType strips params/array/unsigned', () => {
    expect(normalizeBaseType('VARCHAR(255)')).toBe('VARCHAR')
    expect(normalizeBaseType('BIGINT UNSIGNED')).toBe('BIGINT')
    expect(normalizeBaseType('TEXT[]')).toBe('TEXT')
    expect(normalizeBaseType("ENUM('a','b')")).toBe('ENUM')
  })

  it('isKnownType — advisory', () => {
    expect(isKnownType('mysql', 'BIGINT UNSIGNED')).toBe(true)
    expect(isKnownType('mysql', 'GEOGRAPHY')).toBe(false)
    expect(isKnownType('postgresql', 'JSONB')).toBe(true)
    expect(isKnownType('postgresql', 'FOOBAR')).toBe(false)
    expect(isKnownType('sqlite', '무엇이든')).toBe(true) // 어피니티 → 항상 통과
    expect(isKnownType('mysql', '')).toBe(true) // 빈 값은 placeholder UX
  })

  it('typeSuggestions ranks prefix match first', () => {
    const s = typeSuggestions('mysql', 'varchar')
    expect(s[0].insert.startsWith('VARCHAR')).toBe(true)
    expect(typeSuggestions('mysql', 'zzz')).toHaveLength(0)
  })

  it('typeSuggestions surfaces recommended on empty query (pg)', () => {
    const inserts = typeSuggestions('postgresql', '').map((x) => x.insert)
    expect(inserts).toContain('TEXT')
    expect(inserts).toContain('TIMESTAMPTZ')
  })

  it('defaultSuggestions matches case-insensitively', () => {
    expect(defaultSuggestions('postgresql', 'id').map((x) => x.insert)).toContain('IDENTITY')
    expect(defaultSuggestions('mysql', 'auto').map((x) => x.insert)).toContain('AUTO_INCREMENT')
  })
})
