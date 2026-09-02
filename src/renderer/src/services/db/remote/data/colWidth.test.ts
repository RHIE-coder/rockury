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
    // 눈금(step)에 올림하므로 딱 +34 는 아니다 — **버튼 자리가 실제로 확보되는가**가 요점이라
    // `+34 이상`으로 잰다(올림은 언제나 넓히는 쪽이라 이 검사가 느슨해지지 않는다).
    expect(withBtn.bio).toBeGreaterThanOrEqual(plain.bio + 34)
    // 눈금을 끄면 예전처럼 정확히 그만큼이다.
    const exactPlain = autoColumnWidths([{ name: 'bio' }], [{ bio: 'Software engineer at Acme' }], { step: 1 })
    const exactBtn = autoColumnWidths([{ name: 'bio', trailingPx: 34 }], [{ bio: 'Software engineer at Acme' }], { step: 1 })
    expect(exactBtn.bio).toBe(exactPlain.bio + 34)
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

describe('autoColumnWidths — 폭을 눈금에 맞춰 고르게', () => {
  const { min, max, step } = COL_WIDTH_DEFAULTS

  it('모든 폭이 눈금(step)의 배수다 — 칸마다 제각각이면 표가 들쭉날쭉해 보인다', () => {
    const cols = [{ name: 'id' }, { name: 'email' }, { name: 'a_rather_long_column_name' }, { name: 'note' }]
    const rows = [
      { id: 1, email: 'someone@example.com', a_rather_long_column_name: 'x', note: 'y'.repeat(120) },
      { id: 22, email: 'a@b.co', a_rather_long_column_name: 'zz', note: 'y' }
    ]
    for (const w of Object.values(autoColumnWidths(cols, rows))) {
      expect(w % step).toBe(0)
    }
  })

  it('가장 좁은 칸과 가장 넓은 칸의 차이가 눈금 열 칸 안에 든다', () => {
    const cols = [{ name: 'ok' }, { name: 'body' }]
    const w = autoColumnWidths(cols, [{ ok: 1, body: 'x'.repeat(5000) }])
    expect((w.body - w.ok) / step).toBeLessThanOrEqual((max - min) / step)
    expect(w.ok).toBe(min)
    expect(w.body).toBe(max)
  })

  it('눈금 올림이 상한을 넘기지 않는다', () => {
    const w = autoColumnWidths([{ name: 'c' }], [{ c: 'x'.repeat(400) }], { max: 250, step: 40 })
    expect(w.c).toBeLessThanOrEqual(250)
  })

  it('step 1 이면 눈금을 안 쓴다 — 예전 계산 그대로', () => {
    const w = autoColumnWidths([{ name: 'c' }], [{ c: 'x'.repeat(30) }], { step: 1, min: 0, max: 9999 })
    expect(w.c).toBe(Math.round(30 * COL_WIDTH_DEFAULTS.charPx + COL_WIDTH_DEFAULTS.padPx))
  })
})
