import { describe, it, expect } from 'vitest'
import { parseVersion, formatVersion, nextVersion, FIRST_VERSION } from './versionNumber'

describe('parseVersion', () => {
  it('v 접두 + 세 자리를 파싱한다', () => {
    expect(parseVersion('v0.3.14')).toEqual({ major: 0, minor: 3, patch: 14 })
  })
  it('v 접두는 선택이다', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })
  it('생략된 minor/patch 는 0 으로 채운다', () => {
    expect(parseVersion('v2')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(parseVersion('v2.5')).toEqual({ major: 2, minor: 5, patch: 0 })
  })
  it('공백을 다듬는다', () => {
    expect(parseVersion('  v0.1.0 ')).toEqual({ major: 0, minor: 1, patch: 0 })
  })
  it('형식에 안 맞으면 null', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('draft')).toBeNull()
    expect(parseVersion('v1.2.3.4')).toBeNull()
    expect(parseVersion('vx.y')).toBeNull()
  })
})

describe('formatVersion', () => {
  it('v{major}.{minor}.{patch} 로 되돌린다', () => {
    expect(formatVersion({ major: 0, minor: 3, patch: 14 })).toBe('v0.3.14')
  })
})

describe('nextVersion', () => {
  it('patch 가 기본 — 마지막 자리만 +1', () => {
    expect(nextVersion('v0.3.14')).toBe('v0.3.15')
  })
  it('minor 는 minor+1, patch 0', () => {
    expect(nextVersion('v0.3.14', 'minor')).toBe('v0.4.0')
  })
  it('major 는 major+1, 나머지 0', () => {
    expect(nextVersion('v0.3.14', 'major')).toBe('v1.0.0')
  })
  it('current 가 없으면 첫 버전', () => {
    expect(nextVersion(null)).toBe(FIRST_VERSION)
    expect(nextVersion(undefined)).toBe(FIRST_VERSION)
    expect(nextVersion('')).toBe(FIRST_VERSION)
  })
  it('파싱 불가하면 첫 버전으로 안전 복귀', () => {
    expect(nextVersion('draft')).toBe(FIRST_VERSION)
  })
})
