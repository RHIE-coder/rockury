import { describe, expect, it } from 'vitest'
import { applyMove, bucketByGroup, insertionIndex, reorderList, verticalInsertionIndex, type Rect } from './dnd'

/** 폭 100·높이 50 카드, 가로 간격 10·세로 간격 10 의 그리드 rect 생성. */
function grid(cols: number, count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const left = col * 110
    const top = row * 60
    return { left, top, right: left + 100, bottom: top + 50 }
  })
}

describe('insertionIndex', () => {
  it('빈 목록이면 0', () => {
    expect(insertionIndex([], { x: 50, y: 50 })).toBe(0)
  })

  it('한 행: 카드 중심 앞이면 그 카드 인덱스, 뒤면 다음', () => {
    const r = grid(3, 3) // [0..100] [110..210] [220..320]
    expect(insertionIndex(r, { x: 30, y: 25 })).toBe(0) // 첫 카드 중심(50) 앞
    expect(insertionIndex(r, { x: 80, y: 25 })).toBe(1) // 첫 카드 중심 뒤
    expect(insertionIndex(r, { x: 200, y: 25 })).toBe(2) // 둘째 카드 중심(160) 뒤
    expect(insertionIndex(r, { x: 400, y: 25 })).toBe(3) // 행 끝
  })

  it('여러 행: 포인터 y 가 속한 행에서 판정', () => {
    const r = grid(2, 4) // 2×2
    expect(insertionIndex(r, { x: 30, y: 85 })).toBe(2) // 둘째 행 첫 카드 앞
    expect(insertionIndex(r, { x: 300, y: 85 })).toBe(4) // 둘째 행 끝
  })

  it('모든 행 위쪽이면 0, 아래쪽이면 n', () => {
    const r = grid(2, 4)
    expect(insertionIndex(r, { x: 30, y: -20 })).toBe(0)
    expect(insertionIndex(r, { x: 30, y: 999 })).toBe(4)
  })

  it('행 사이 간격에서는 아래 행으로 판정', () => {
    const r = grid(2, 4) // 1행 bottom=50, 2행 top=60
    expect(insertionIndex(r, { x: 30, y: 55 })).toBe(2)
  })
})

describe('bucketByGroup', () => {
  const c = (id: string, groupId: string | null) => ({ id, groupId })

  it('그룹 순서대로 버킷을 만들고 미분류는 null 키', () => {
    const buckets = bucketByGroup([c('a', 'g1'), c('b', null), c('c', 'g1'), c('d', 'g2')], ['g1', 'g2'])
    expect(buckets.get('g1')!.map((x) => x.id)).toEqual(['a', 'c'])
    expect(buckets.get('g2')!.map((x) => x.id)).toEqual(['d'])
    expect(buckets.get(null)!.map((x) => x.id)).toEqual(['b'])
  })

  it('사라진 그룹을 가리키는 연결은 미분류로 — 카드 증발 방지', () => {
    const buckets = bucketByGroup([c('a', 'g-없음')], ['g1'])
    expect(buckets.get(null)!.map((x) => x.id)).toEqual(['a'])
    expect(buckets.get('g1')).toEqual([])
  })
})

describe('applyMove', () => {
  const c = (id: string, groupId: string | null) => ({ id, groupId })
  // 캐논 평탄화: g1 카드들 → g2 카드들 → 미분류
  const list = [c('a', null), c('b', 'g1'), c('c', 'g1'), c('d', null)]

  it('미분류 카드를 그룹 중간으로', () => {
    expect(applyMove(list, ['g1'], 'a', 'g1', 1)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('그룹 카드를 미분류로 빼기', () => {
    expect(applyMove(list, ['g1'], 'b', null, 0)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('같은 섹션 안 순서 변경 — 자기 자신은 삽입 위치 계산에서 빠진다', () => {
    // g1: [b, c] 에서 b 를 c 뒤(빼고 난 목록의 index 1)로
    expect(applyMove(list, ['g1'], 'b', 'g1', 1)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('targetIndex 가 범위를 넘으면 끝으로 클램프', () => {
    expect(applyMove(list, ['g1'], 'a', 'g1', 99)).toEqual(['b', 'c', 'a', 'd'])
    expect(applyMove(list, ['g1'], 'a', 'g1', -5)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('알 수 없는 대상 그룹은 미분류로 취급', () => {
    expect(applyMove(list, ['g1'], 'b', 'g-없음', 0)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('여러 그룹의 캐논 순서: 그룹 목록 순 → 미분류 마지막', () => {
    const multi = [c('u1', null), c('x', 'g2'), c('y', 'g1')]
    expect(applyMove(multi, ['g1', 'g2'], 'u1', 'g2', 1)).toEqual(['y', 'x', 'u1'])
  })
})

describe('verticalInsertionIndex', () => {
  // 세로 스택: [0..40] [50..90] [100..140]
  const rects = [
    { top: 0, bottom: 40 },
    { top: 50, bottom: 90 },
    { top: 100, bottom: 140 }
  ]

  it('요소 세로 중심 앞이면 그 인덱스, 뒤면 다음', () => {
    expect(verticalInsertionIndex(rects, 10)).toBe(0) // 첫 중심(20) 앞
    expect(verticalInsertionIndex(rects, 30)).toBe(1) // 첫 중심 뒤
    expect(verticalInsertionIndex(rects, 60)).toBe(1) // 둘째 중심(70) 앞
    expect(verticalInsertionIndex(rects, 110)).toBe(2) // 셋째 중심(120) 앞
    expect(verticalInsertionIndex(rects, 120)).toBe(3) // 셋째 중심(120)=경계 → 뒤(y<중심 이므로)
  })

  it('전부 위면 0, 전부 아래면 n', () => {
    expect(verticalInsertionIndex(rects, -10)).toBe(0)
    expect(verticalInsertionIndex(rects, 999)).toBe(3)
  })

  it('빈 목록이면 0', () => {
    expect(verticalInsertionIndex([], 50)).toBe(0)
  })
})

describe('reorderList', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('앞으로 이동', () => {
    expect(reorderList(ids, 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('뒤로 이동 — 자기 자신을 뺀 목록 기준 인덱스', () => {
    expect(reorderList(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('제자리면 순서 불변', () => {
    expect(reorderList(ids, 'b', 1)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('범위 밖 인덱스는 클램프', () => {
    expect(reorderList(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a'])
    expect(reorderList(ids, 'd', -5)).toEqual(['d', 'a', 'b', 'c'])
  })
})
