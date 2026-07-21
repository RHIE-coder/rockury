import { describe, expect, it } from 'vitest'
import { bumpVer, compareVer, latestVer, parseVer } from './semver'

describe('semver', () => {
  it('parseVer', () => {
    expect(parseVer('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVer('  v0.3.14 ')).toEqual([0, 3, 14])
    expect(parseVer('1.2.3')).toBeNull()
    expect(parseVer('vX')).toBeNull()
  })

  it('compareVer is numeric, not lexical', () => {
    expect(compareVer('v0.1.0', 'v0.2.0')).toBeLessThan(0)
    expect(compareVer('v0.10.0', 'v0.2.0')).toBeGreaterThan(0) // 10 > 2 (렉시컬이면 반대)
    expect(compareVer('v1.0.0', 'v1.0.0')).toBe(0)
  })

  it('latestVer picks the highest by number', () => {
    expect(latestVer([])).toBeNull()
    expect(latestVer(['v0.1.0', 'v0.10.0', 'v0.2.0', 'v0.9.0'])).toBe('v0.10.0')
  })

  it('bumpVer', () => {
    expect(bumpVer('v0.4.0', 'patch')).toBe('v0.4.1')
    expect(bumpVer('v0.4.3', 'minor')).toBe('v0.5.0')
    expect(bumpVer('v0.4.3', 'major')).toBe('v1.0.0')
    expect(bumpVer('v0.0.0', 'minor')).toBe('v0.1.0')
  })
})
