import { describe, it, expect } from 'vitest'
import { exportFileName } from './export'

describe('exportFileName', () => {
  const d = new Date(2026, 6, 23, 9, 5, 7) // 2026-07-23 09:05:07 (로컬)

  it('erd-<연결>-<타임스탬프>.<ext> 형식', () => {
    expect(exportFileName('prod', 'png', d)).toBe('erd-prod-20260723-090507.png')
    expect(exportFileName('prod', 'svg', d)).toBe('erd-prod-20260723-090507.svg')
  })

  it('연결명의 비안전 문자는 하이픈으로 정규화', () => {
    expect(exportFileName('My DB @ Host:5432', 'png', d)).toBe('erd-My-DB-Host-5432-20260723-090507.png')
  })

  it('빈/전부불안전 연결명은 diagram 으로 폴백', () => {
    expect(exportFileName('', 'png', d)).toBe('erd-diagram-20260723-090507.png')
    expect(exportFileName('@@@', 'svg', d)).toBe('erd-diagram-20260723-090507.svg')
  })
})
