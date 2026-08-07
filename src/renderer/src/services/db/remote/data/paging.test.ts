import { describe, expect, it } from 'vitest'
import { clampPageIndex, pageCount, parsePageInput } from './paging'

/**
 * CASE-remote-061 — 쪽 번호 정규화(db-remote.data.paging AC-2/AC-4a).
 * 핵심은 "총 쪽수를 모를 때"다 — 모른다는 이유로 이동을 막으면 셈이 느린 큰 표에서 아무 데도 못 간다.
 */
describe('pageCount — 총 쪽수', () => {
  it('행 수를 모르면 쪽수도 모른다', () => {
    expect(pageCount(null, 50)).toBeNull()
  })

  it('행이 0이어도 1쪽이다', () => {
    // "0쪽"인 표는 없다 — 빈 표도 볼 쪽이 한 장은 있다.
    expect(pageCount(0, 50)).toBe(1)
  })

  it('딱 나누어떨어지면 그만큼, 남으면 한 쪽 더', () => {
    expect(pageCount(50, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
    expect(pageCount(100, 25)).toBe(4)
    expect(pageCount(101, 25)).toBe(5)
  })

  it('쪽 크기가 0 이하로 들어와도 터지지 않는다', () => {
    expect(pageCount(100, 0)).toBe(1)
    expect(pageCount(100, -5)).toBe(1)
  })
})

describe('clampPageIndex — 범위 안으로 당겨 잡기', () => {
  it('아래로 넘치면 첫 쪽', () => {
    expect(clampPageIndex(-5, 3)).toBe(0)
  })

  it('위로 넘치면 마지막 쪽', () => {
    expect(clampPageIndex(10, 3)).toBe(2)
  })

  it('총 쪽수를 모르면 위쪽 상한을 걸지 않는다', () => {
    expect(clampPageIndex(10, null)).toBe(10)
    expect(clampPageIndex(-1, null)).toBe(0)
  })
})

describe('parsePageInput — 입력 칸에 친 숫자 → 쪽 번호(0부터)', () => {
  it('1부터 세는 입력을 0부터 세는 번호로 옮긴다', () => {
    expect(parsePageInput('3', 0, 10)).toBe(2)
  })

  it('범위 밖은 가장 가까운 쪽으로 당겨 잡는다', () => {
    expect(parsePageInput('0', 5, 10)).toBe(0)
    expect(parsePageInput('-2', 5, 10)).toBe(0)
    expect(parsePageInput('999', 5, 10)).toBe(9)
  })

  it('숫자가 아니면 보고 있던 쪽 그대로', () => {
    expect(parsePageInput('abc', 5, 10)).toBe(5)
    expect(parsePageInput('', 5, 10)).toBe(5)
    expect(parsePageInput('   ', 5, 10)).toBe(5)
  })

  it('앞뒤 공백은 무시하고 소수는 내림', () => {
    expect(parsePageInput(' 4 ', 0, 10)).toBe(3)
    expect(parsePageInput('3.7', 0, 10)).toBe(2)
  })

  it('총 쪽수를 모르면 위로는 막지 않는다', () => {
    expect(parsePageInput('999', 0, null)).toBe(998)
  })
})
