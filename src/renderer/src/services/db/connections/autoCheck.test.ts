import { describe, expect, it } from 'vitest'
import { autoCheckTargets, partitionAutoCheck } from './autoCheck'

describe('autoCheckTargets', () => {
  const c = (id: string, autoCheckDisabled: boolean): { id: string; autoCheckDisabled: boolean } => ({
    id,
    autoCheckDisabled
  })

  it('자동확인 무시가 꺼진 연결만 남긴다', () => {
    const list = [c('a', false), c('b', true), c('c', false)]
    expect(autoCheckTargets(list).map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('모두 무시면 빈 배열', () => {
    expect(autoCheckTargets([c('a', true), c('b', true)])).toEqual([])
  })

  it('빈 입력이면 빈 배열', () => {
    expect(autoCheckTargets([])).toEqual([])
  })

  it('원본을 변형하지 않는다', () => {
    const list = [c('a', false), c('b', true)]
    autoCheckTargets(list)
    expect(list).toHaveLength(2)
  })
})

describe('partitionAutoCheck', () => {
  const c = (id: string, autoCheckDisabled: boolean): { id: string; autoCheckDisabled: boolean } => ({
    id,
    autoCheckDisabled
  })

  it('대상과 제외를 갈라 담는다 — 제외는 상태 초기화 대상', () => {
    const { targets, skipped } = partitionAutoCheck([c('a', false), c('b', true), c('c', false)])
    expect(targets.map((x) => x.id)).toEqual(['a', 'c'])
    expect(skipped.map((x) => x.id)).toEqual(['b'])
  })

  it('모두 제외면 targets 는 비고 skipped 가 전부 담는다', () => {
    const { targets, skipped } = partitionAutoCheck([c('a', true), c('b', true)])
    expect(targets).toEqual([])
    expect(skipped.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('빈 입력이면 둘 다 빈 배열', () => {
    expect(partitionAutoCheck([])).toEqual({ targets: [], skipped: [] })
  })
})
