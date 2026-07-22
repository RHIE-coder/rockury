import { describe, expect, it } from 'vitest'
import { normalizeDateTime, nowDateTime, toDateTimeString } from './timeValue'

describe('toDateTimeString — Date → 리터럴 포맷', () => {
  it('로컬 구성요소를 YYYY-MM-DD HH:mm:ss 로', () => {
    const d = new Date(2025, 0, 2, 3, 4, 5, 678) // 로컬 2025-01-02 03:04:05.678
    expect(toDateTimeString(d)).toBe('2025-01-02 03:04:05')
    expect(toDateTimeString(d, true)).toBe('2025-01-02 03:04:05.678')
  })
})

describe('normalizeDateTime — 입력 정규화', () => {
  it('완전한 datetime 은 그대로', () => {
    expect(normalizeDateTime('2025-01-02 03:04:05')).toBe('2025-01-02 03:04:05')
  })
  it('날짜만이면 00:00:00 을 붙인다', () => {
    expect(normalizeDateTime('2025-07-15')).toBe('2025-07-15 00:00:00')
  })
  it('ISO(T·Z) 는 벗겨 로컬 리터럴로', () => {
    expect(normalizeDateTime('2025-01-02T03:04:05Z')).toBe('2025-01-02 03:04:05')
    expect(normalizeDateTime('2025-01-02T03:04:05.120+09:00')).toBe('2025-01-02 03:04:05.120')
  })
  it('밀리초는 3자리로 패딩', () => {
    expect(normalizeDateTime('2025-01-02 03:04:05.1')).toBe('2025-01-02 03:04:05.100')
  })
  it('분까지만 있으면 초를 00 으로', () => {
    expect(normalizeDateTime('2025-01-02 03:04')).toBe('2025-01-02 03:04:00')
  })
  it('빈 값/형식 불명은 null(거부)', () => {
    expect(normalizeDateTime('')).toBeNull()
    expect(normalizeDateTime('not-a-date')).toBeNull()
    expect(normalizeDateTime('2025/01/02')).toBeNull()
  })
})

describe('nowDateTime — NOW 값', () => {
  it('도우미 포맷(.SSS 포함)을 만든다', () => {
    expect(nowDateTime()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
  })
})
