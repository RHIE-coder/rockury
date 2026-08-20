import { describe, expect, it } from 'vitest'
import { dropTarget, guideLine, isSamePlace, type NodeRect, type SectionRect } from './dnd'
import { moveComponent } from '../tree'
import type { SurfaceContent } from '../types'


const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

/** 세로로 쌓인 영역 하나에 요소 셋(각 높이 20, 간격 없음). */
const sections: SectionRect[] = [{ id: 'form', rect: rect(0, 0, 100, 100), horizontal: false }]
const nodes: NodeRect[] = [
  { id: 'a', sectionId: 'form', rect: rect(0, 0, 100, 20) },
  { id: 'b', sectionId: 'form', rect: rect(0, 20, 100, 40) },
  { id: 'c', sectionId: 'form', rect: rect(0, 40, 100, 60) }
]

const content: SurfaceContent = {
  sections: [
    {
      id: 'form',
      name: '입력',
      components: [
        { id: 'a', type: 'input' },
        { id: 'b', type: 'input' },
        { id: 'c', type: 'button' }
      ]
    },
    { id: 'side', name: '옆', components: [] }
  ]
}

describe('드롭 자리 정하기', () => {
  it('CASE-uiux-080 세로 배치는 위아래 중심으로 가른다', () => {
    // 'a' 를 끌고 있다 → 남은 것은 b(20~40)·c(40~60). 그 중심은 30·50.
    expect(dropTarget({ x: 50, y: 5 }, sections, nodes, 'a')).toEqual({ sectionId: 'form', index: 0 })
    expect(dropTarget({ x: 50, y: 35 }, sections, nodes, 'a')).toEqual({ sectionId: 'form', index: 1 })
    expect(dropTarget({ x: 50, y: 55 }, sections, nodes, 'a')).toEqual({ sectionId: 'form', index: 2 })
  })

  it('CASE-uiux-080 가로 배치는 좌우 중심으로 가른다', () => {
    const row: SectionRect[] = [{ id: 'form', rect: rect(0, 0, 100, 40), horizontal: true }]
    const cols: NodeRect[] = [
      { id: 'a', sectionId: 'form', rect: rect(0, 0, 30, 40) },
      { id: 'b', sectionId: 'form', rect: rect(30, 0, 60, 40) }
    ]
    expect(dropTarget({ x: 5, y: 20 }, row, cols, 'a')).toEqual({ sectionId: 'form', index: 0 })
    expect(dropTarget({ x: 50, y: 20 }, row, cols, 'a')).toEqual({ sectionId: 'form', index: 1 })
  })

  it('CASE-uiux-080 격자·줄바꿈은 줄부터 가른다 — 좌우만 보면 아랫줄이 윗줄보다 앞이 된다', () => {
    // 2열 격자: 윗줄 a·b, 아랫줄 c.
    const grid: SectionRect[] = [{ id: 'g', rect: rect(0, 0, 100, 80), horizontal: true }]
    const cells: NodeRect[] = [
      { id: 'a', sectionId: 'g', rect: rect(0, 0, 50, 40) },
      { id: 'b', sectionId: 'g', rect: rect(50, 0, 100, 40) },
      { id: 'c', sectionId: 'g', rect: rect(0, 40, 50, 80) }
    ]
    // 아랫줄 왼쪽(x 는 작지만 y 가 아래) → 윗줄 a·b 보다는 뒤, 같은 줄 c 보다는 앞.
    expect(dropTarget({ x: 10, y: 70 }, grid, cells, 'x')?.index).toBe(2)
    // 아랫줄 c 의 오른쪽 절반 → 맨 뒤.
    expect(dropTarget({ x: 40, y: 70 }, grid, cells, 'x')?.index).toBe(3)
    // 윗줄 왼쪽 끝 → 맨 앞.
    expect(dropTarget({ x: 5, y: 20 }, grid, cells, 'x')?.index).toBe(0)
    // 윗줄 b 의 왼쪽 절반 → a 뒤, b 앞.
    expect(dropTarget({ x: 60, y: 20 }, grid, cells, 'x')?.index).toBe(1)
  })

  it('CASE-uiux-081 끌고 있는 것은 세지 않는다 — 그래서 나온 자리가 곧 moveComponent 기준이다', () => {
    // 'b'(가운데)를 끌 때 남은 것은 a(0~20)·c(40~60), 중심 10·50.
    expect(dropTarget({ x: 50, y: 5 }, sections, nodes, 'b')?.index).toBe(0)
    expect(dropTarget({ x: 50, y: 30 }, sections, nodes, 'b')?.index).toBe(1)
    expect(dropTarget({ x: 50, y: 55 }, sections, nodes, 'b')?.index).toBe(2)
  })

  it('CASE-uiux-081 그 자리를 moveComponent 에 그대로 넣으면 의도대로 옮겨진다', () => {
    // b 를 맨 아래로: 중심 50 아래에 놓으면 index 2 → [a, c, b]
    const target = dropTarget({ x: 50, y: 55 }, sections, nodes, 'b')!
    const moved = moveComponent(content, 'b', target.sectionId, target.index)
    expect(moved.sections[0].components.map((c) => c.id)).toEqual(['a', 'c', 'b'])

    // b 를 맨 위로: index 0 → [b, a, c]
    const up = dropTarget({ x: 50, y: 5 }, sections, nodes, 'b')!
    expect(moveComponent(content, 'b', up.sectionId, up.index).sections[0].components.map((c) => c.id)).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('CASE-uiux-082 빈 영역에 놓으면 0번', () => {
    const empty: SectionRect[] = [{ id: 'side', rect: rect(0, 100, 100, 160), horizontal: false }]
    expect(dropTarget({ x: 50, y: 130 }, empty, nodes, 'a')).toEqual({ sectionId: 'side', index: 0 })
  })

  it('CASE-uiux-082 어느 영역에도 안 걸리면 null (놓아도 아무 일 없음)', () => {
    expect(dropTarget({ x: 50, y: 500 }, sections, nodes, 'a')).toBeNull()
    expect(dropTarget({ x: 500, y: 50 }, sections, nodes, 'a')).toBeNull()
  })

  it('CASE-uiux-082 영역이 겹치면 안쪽(나중에 그려진 것)을 쓴다', () => {
    const nested: SectionRect[] = [
      { id: 'outer', rect: rect(0, 0, 100, 100), horizontal: false },
      { id: 'inner', rect: rect(10, 10, 90, 90), horizontal: false }
    ]
    expect(dropTarget({ x: 50, y: 50 }, nested, [], 'x')?.sectionId).toBe('inner')
    expect(dropTarget({ x: 5, y: 5 }, nested, [], 'x')?.sectionId).toBe('outer')
  })
})

describe('제자리 판정', () => {
  it('CASE-uiux-083 원래 자리에 놓으면 옮기지 않는다 (제자리 저장으로 이력이 지저분해지지 않게)', () => {
    expect(isSamePlace(content, 'b', { sectionId: 'form', index: 1 })).toBe(true)
    expect(isSamePlace(content, 'b', { sectionId: 'form', index: 0 })).toBe(false)
    expect(isSamePlace(content, 'b', { sectionId: 'side', index: 0 })).toBe(false)
  })

  it('CASE-uiux-083 없는 요소는 옮길 것이 없으므로 제자리로 본다', () => {
    expect(isSamePlace(content, '없음', { sectionId: 'form', index: 0 })).toBe(true)
  })
})

describe('가이드 선', () => {
  it('CASE-uiux-084 넣을 곳 앞뒤 사이에 긋는다 — 요소 위에 겹치면 "얹는다"로 읽힌다', () => {
    // 'a' 를 끌 때 index 1 = b(20~40) 와 c(40~60) 사이 → y ≈ 38~40
    const line = guideLine({ sectionId: 'form', index: 1 }, sections, nodes, 'a')!
    expect(line.height).toBe(2)
    expect(line.top).toBeGreaterThanOrEqual(38)
    expect(line.top).toBeLessThanOrEqual(40)
  })

  it('CASE-uiux-084 가로 배치는 세로선으로 긋는다', () => {
    const row: SectionRect[] = [{ id: 'form', rect: rect(0, 0, 100, 40), horizontal: true }]
    const cols: NodeRect[] = [{ id: 'b', sectionId: 'form', rect: rect(30, 0, 60, 40) }]
    const line = guideLine({ sectionId: 'form', index: 0 }, row, cols, 'a')!
    expect(line.width).toBe(2)
    expect(line.height).toBeGreaterThan(2)
  })

  it('CASE-uiux-085 빈 영역이면 영역 맨 앞에 긋는다', () => {
    const empty: SectionRect[] = [{ id: 'side', rect: rect(0, 100, 100, 160), horizontal: false }]
    const line = guideLine({ sectionId: 'side', index: 0 }, empty, [], 'a')!
    expect(line.top).toBe(102)
    expect(line.width).toBeGreaterThan(0)
  })

  it('CASE-uiux-085 없는 영역이면 null', () => {
    expect(guideLine({ sectionId: '없음', index: 0 }, sections, nodes, 'a')).toBeNull()
  })
})
