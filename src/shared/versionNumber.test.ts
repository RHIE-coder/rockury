import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  formatVersion,
  nextVersion,
  isVersionNumber,
  compareVersion,
  highestVersion,
  FIRST_VERSION
} from './versionNumber'

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

describe('isVersionNumber', () => {
  it('정규형만 통과', () => {
    expect(isVersionNumber('v0.1.0')).toBe(true)
    expect(isVersionNumber('v12.4.130')).toBe(true)
  })
  it('사람이 적은 축약형·잡문자는 거절 — 고쳐서 넣는 것은 부르는 쪽 몫', () => {
    expect(isVersionNumber('0.2')).toBe(false)
    expect(isVersionNumber('v2')).toBe(false)
    expect(isVersionNumber(' v0.1.0 ')).toBe(false)
    expect(isVersionNumber('v01.0.0')).toBe(false)
    expect(isVersionNumber('최종본')).toBe(false)
    expect(isVersionNumber('')).toBe(false)
  })
})

describe('compareVersion', () => {
  it('자리별로 견준다 — 10 은 9 보다 높다(문자 정렬이 아니다)', () => {
    expect(compareVersion('v0.1.0', 'v0.2.0')).toBeLessThan(0)
    expect(compareVersion('v0.3.10', 'v0.3.9')).toBeGreaterThan(0)
    expect(compareVersion('v1.0.0', 'v0.9.9')).toBeGreaterThan(0)
    expect(compareVersion('v1.2.3', 'v1.2.3')).toBe(0)
  })
})

describe('highestVersion', () => {
  it('가장 높은 번호를 고른다 — 목록 순서와 무관', () => {
    expect(highestVersion(['v0.1.0', 'v0.3.10', 'v0.3.9'])).toBe('v0.3.10')
  })
  it('빈 목록은 null', () => {
    expect(highestVersion([])).toBeNull()
  })
  it('정규형이 아닌 옛 번호는 뺀다 — 화면 정렬과 같은 눈으로 봐야 컷이 막히지 않는다', () => {
    expect(highestVersion(['2.0', 'v0.1.0'])).toBe('v0.1.0')
    expect(highestVersion(['최종본'])).toBeNull()
  })
})
