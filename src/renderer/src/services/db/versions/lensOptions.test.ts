import { describe, expect, it } from 'vitest'
import { currentLensOption, lensOptions } from './lensOptions'

/** Studio 렌즈 드롭다운 항목 만들기 — 입력(버전 목록) → 출력(항목 목록)만 본다. */

const versions = [
  { number: 'v0.3.15', note: '시드 추가' },
  { number: 'v0.3.14', note: '' }
]

describe('lensOptions', () => {
  it('Draft 가 항상 맨 위 — 편집 가능한 유일한 자리', () => {
    const out = lensOptions(versions)
    expect(out[0]).toEqual({ id: 'draft', label: 'Draft', hint: '편집 중', readOnly: false })
  })

  it('컷된 버전은 들어온 순서(최신순) 그대로 뒤에 붙고 전부 읽기 전용', () => {
    const out = lensOptions(versions)
    expect(out.map((o) => o.id)).toEqual(['draft', 'v0.3.15', 'v0.3.14'])
    expect(out.slice(1).every((o) => o.readOnly)).toBe(true)
  })

  it('컷 메모가 있으면 그것을, 없으면 "읽기 전용"을 곁말로 쓴다', () => {
    const [, newer, older] = lensOptions(versions)
    expect(newer.hint).toBe('시드 추가')
    expect(older.hint).toBe('읽기 전용')
  })

  it('컷된 버전이 하나도 없어도 Draft 는 남는다', () => {
    expect(lensOptions([]).map((o) => o.id)).toEqual(['draft'])
  })
})

describe('currentLensOption', () => {
  const options = lensOptions(versions)

  it('고른 시점을 돌려준다', () => {
    expect(currentLensOption(options, 'v0.3.15').label).toBe('v0.3.15')
  })

  it('고른 버전이 목록에 없으면 Draft 로 떨어진다 — 없는 시점을 가리킨 채 두지 않는다', () => {
    expect(currentLensOption(options, 'v9.9.9').id).toBe('draft')
  })

  it('빈 값도 Draft 로 본다', () => {
    expect(currentLensOption(options, '').id).toBe('draft')
  })
})
