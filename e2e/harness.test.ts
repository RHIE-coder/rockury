import { describe, expect, it } from 'vitest'
// @ts-expect-error — 하네스는 .mjs(런타임 전용) 라 타입 선언이 없다.
import { isRedFamily } from './lib/harness.mjs'

/**
 * 하네스의 순수 헬퍼 검증.
 *
 * `isRedFamily` 는 2026-08-07 의 실수에서 나왔다: 화면 색을 검사할 때 `rgb()` 만 전제한
 * 정규식을 손으로 써서, **앱은 멀쩡한데 검사가 "빨갛지 않다"고 틀린 답을 냈다.** Tailwind v4 는
 * 투명도가 붙은 색을 `oklab()` 으로 낸다. 같은 실수가 되풀이되지 않게 판정을 한 곳에 모으고
 * 여기서 두 표기를 다 고정한다.
 */
describe('isRedFamily — 계산된 CSS 색이 빨간 계열인가', () => {
  it('불투명한 빨강은 rgb() 로 온다', () => {
    expect(isRedFamily('rgb(176, 82, 76)')).toBe(true)
    expect(isRedFamily('rgba(220, 38, 38, 0.9)')).toBe(true)
  })

  it('투명도가 붙으면 oklab() 으로 오는데 그것도 읽는다', () => {
    // 실측값 — `border-destructive/40` 이 이렇게 나온다.
    expect(isRedFamily('oklab(0.554933 0.111944 0.0536162 / 0.4)')).toBe(true)
    expect(isRedFamily('oklab(0.554933 0.111944 0.0536162 / 0.05)')).toBe(true)
  })

  it('oklch 표기도 읽는다', () => {
    expect(isRedFamily('oklch(0.55 0.19 27)')).toBe(true)
  })

  it('빨갛지 않은 색은 걸러낸다', () => {
    expect(isRedFamily('rgb(35, 43, 52)')).toBe(false) // 기본 글자색
    expect(isRedFamily('rgb(255, 255, 255)')).toBe(false)
    expect(isRedFamily('oklab(0.6 -0.12 0.08 / 0.4)')).toBe(false) // 초록 쪽
    expect(isRedFamily('oklch(0.7 0 0)')).toBe(false) // 무채색
  })

  it('값이 없으면 참이라고 하지 않는다', () => {
    // 색을 못 읽었는데 통과시키면 "검사했다"는 착각만 남는다.
    expect(isRedFamily(null)).toBe(false)
    expect(isRedFamily('')).toBe(false)
    expect(isRedFamily('transparent')).toBe(false)
  })
})
