import { describe, expect, it } from 'vitest'
import { formatDateCell, toDate } from './timezone'

const EPOCH = Date.UTC(2025, 0, 2, 3, 4, 5) // 2025-01-02 03:04:05 UTC

describe('toDate — 다양한 입력 파싱', () => {
  it('epoch 숫자', () => {
    expect(toDate(EPOCH)?.getTime()).toBe(EPOCH)
  })
  it('epoch 문자열', () => {
    expect(toDate(String(EPOCH))?.getTime()).toBe(EPOCH)
  })
  it('datetime 리터럴은 UTC 로 간주', () => {
    expect(toDate('2025-01-02 03:04:05')?.getTime()).toBe(EPOCH)
  })
  it('ISO Z', () => {
    expect(toDate('2025-01-02T03:04:05Z')?.getTime()).toBe(EPOCH)
  })
  it('불명은 null', () => {
    expect(toDate('nope')).toBeNull()
    expect(toDate(null)).toBeNull()
  })
})

describe('formatDateCell — 3-way 타임존', () => {
  it('UTC', () => {
    expect(formatDateCell(EPOCH, 'UTC')).toBe('2025-01-02 03:04:05')
  })
  it('LOCAL(Asia/Seoul, +9)', () => {
    expect(formatDateCell(EPOCH, 'LOCAL', 'Asia/Seoul')).toBe('2025-01-02 12:04:05')
  })
  it('LOCAL(America/New_York, -5)', () => {
    expect(formatDateCell(EPOCH, 'LOCAL', 'America/New_York')).toBe('2025-01-01 22:04:05')
  })
  it('TIMESTAMP(epoch ms)', () => {
    expect(formatDateCell(EPOCH, 'TIMESTAMP')).toBe(String(EPOCH))
  })
  it('파싱 실패 시 원본 유지', () => {
    expect(formatDateCell('not-a-date', 'UTC')).toBe('not-a-date')
    expect(formatDateCell(null, 'UTC')).toBe('')
  })
})
