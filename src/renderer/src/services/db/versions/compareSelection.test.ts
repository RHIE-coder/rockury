import { describe, expect, it } from 'vitest'
import { comparePair, togglePick } from './compareSelection'

describe('togglePick', () => {
  it('고르면 담기고 다시 고르면 빠진다', () => {
    expect(togglePick([], 'a')).toEqual(['a'])
    expect(togglePick(['a'], 'a')).toEqual([])
  })

  it('둘까지 담는다', () => {
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('셋째를 고르면 가장 먼저 고른 것이 빠진다 — 막다른 길을 안 만든다', () => {
    expect(togglePick(['a', 'b'], 'c')).toEqual(['b', 'c'])
  })

  it('원본을 안 건드린다', () => {
    const picked = ['a', 'b']
    togglePick(picked, 'c')
    expect(picked).toEqual(['a', 'b'])
  })
})

describe('comparePair', () => {
  // 목록은 최신이 위 — v3 가 첫 줄이다.
  const versions = [{ id: 'v3' }, { id: 'v2' }, { id: 'v1' }]

  it('둘이 안 차면 없다', () => {
    expect(comparePair(versions, [])).toBeNull()
    expect(comparePair(versions, ['v2'])).toBeNull()
  })

  it('아래(이전) → 위(이후) 로 세운다', () => {
    expect(comparePair(versions, ['v3', 'v1'])).toEqual({ base: { id: 'v1' }, target: { id: 'v3' } })
  })

  it('고른 순서가 거꾸로여도 시간 순은 같다 — diff 방향이 고른 순서를 안 탄다', () => {
    expect(comparePair(versions, ['v1', 'v3'])).toEqual(comparePair(versions, ['v3', 'v1']))
  })

  it('목록에 없는 버전이 섞이면 비교하지 않는다 — 삭제된 뒤 남은 고름', () => {
    expect(comparePair(versions, ['v3', 'gone'])).toBeNull()
  })
})
