import { describe, expect, it } from 'vitest'
import { autoColumnWidths, cellTextLength, COL_WIDTH_DEFAULTS } from './colWidth'

describe('cellTextLength', () => {
  it('null/undefined 는 화면에 보이는 NULL 길이', () => {
    expect(cellTextLength(null)).toBe(4)
    expect(cellTextLength(undefined)).toBe(4)
  })

  it('객체는 JSON 문자열 길이', () => {
    expect(cellTextLength({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length)
  })

  it('원시값은 문자열 길이', () => {
    expect(cellTextLength(12345)).toBe(5)
    expect(cellTextLength('hello')).toBe(5)
    expect(cellTextLength(true)).toBe(4)
  })

  it('순환 참조처럼 JSON 이 안 되는 값도 터지지 않는다', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => cellTextLength(cyclic)).not.toThrow()
  })
})

describe('autoColumnWidths', () => {
  const { min, max } = COL_WIDTH_DEFAULTS

  it('짧은 내용은 최소 폭', () => {
    const w = autoColumnWidths([{ name: 'id' }], [{ id: 1 }, { id: 2 }])
    expect(w.id).toBe(min)
  })

  it('긴 내용도 최대 폭을 넘지 않는다', () => {
    const w = autoColumnWidths([{ name: 'body' }], [{ body: 'x'.repeat(5000) }])
    expect(w.body).toBe(max)
  })

  it('가장 긴 값에 맞춘다 — 짧은 값이 뒤에 와도 줄지 않는다', () => {
    const longer = autoColumnWidths([{ name: 'email' }], [{ email: 'a@b.co' }, { email: 'very.long.address@example.com' }])
    const shorter = autoColumnWidths([{ name: 'email' }], [{ email: 'a@b.co' }])
    expect(longer.email).toBeGreaterThan(shorter.email)
    expect(longer.email).toBeLessThanOrEqual(max)
  })

  it('값이 짧아도 헤더(컬럼명)가 길면 헤더에 맞춘다', () => {
    const w = autoColumnWidths([{ name: 'a_very_long_column_name_here' }], [{ a_very_long_column_name_here: 1 }])
    expect(w.a_very_long_column_name_here).toBeGreaterThan(min)
  })

  it('키 배지가 붙는 컬럼은 그만큼 넓다', () => {
    const plain = autoColumnWidths([{ name: 'user_id' }], [{ user_id: 1 }])
    const badged = autoColumnWidths([{ name: 'user_id', badges: 2 }], [{ user_id: 1 }])
    expect(badged.user_id).toBeGreaterThan(plain.user_id)
  })

  it('셀 안 버튼/칩 폭(trailingPx)만큼 더 넓어진다 — 값이 버튼에 가려 잘리지 않게', () => {
    const plain = autoColumnWidths([{ name: 'bio' }], [{ bio: 'Software engineer at Acme' }])
    const withBtn = autoColumnWidths([{ name: 'bio', trailingPx: 34 }], [{ bio: 'Software engineer at Acme' }])
    expect(withBtn.bio).toBe(plain.bio + 34)
  })

  it('trailingPx 를 더해도 최대 폭 상한은 지킨다', () => {
    const w = autoColumnWidths([{ name: 'bio', trailingPx: 200 }], [{ bio: 'x'.repeat(400) }])
    expect(w.bio).toBe(max)
  })

  it('행이 없어도 모든 컬럼에 헤더 기준 폭을 준다', () => {
    const w = autoColumnWidths([{ name: 'id' }, { name: 'created_at', typeLabel: 'timestamp' }], [])
    expect(Object.keys(w)).toEqual(['id', 'created_at'])
    expect(w.created_at).toBeGreaterThanOrEqual(min)
  })

  it('표본 행 수를 넘는 뒤쪽 행은 폭에 영향을 주지 않는다(비용 상한)', () => {
    const rows = [...Array(10).keys()].map(() => ({ v: 'short' }))
    rows.push({ v: 'x'.repeat(300) })
    const w = autoColumnWidths([{ name: 'v' }], rows, { sampleRows: 10 })
    expect(w.v).toBe(min)
  })

  it('NULL 만 있는 컬럼도 최소 폭을 지킨다', () => {
    const w = autoColumnWidths([{ name: 'deleted_at' }], [{ deleted_at: null }])
    expect(w.deleted_at).toBeGreaterThanOrEqual(min)
  })
})
