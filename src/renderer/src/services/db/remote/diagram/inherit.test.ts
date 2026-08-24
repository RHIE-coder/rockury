import { describe, expect, it } from 'vitest'
import { withInheritedLayout, type InheritedLayout } from './inherit'
import type { DiagramGroup } from './group'

const g = (id: string): DiagramGroup => ({
  id,
  name: id,
  color: '',
  tableIds: [],
  collapsed: false,
  x: 0,
  y: 0
})

const base: InheritedLayout = {
  positions: { 't:users': { x: 10, y: 20 } },
  viewport: { x: 1, y: 2, zoom: 1.5 },
  groups: [g('g1')]
}

describe('withInheritedLayout — 물려받은 배치의 첫 저장', () => {
  it('물려받은 것이 없으면 패치를 그대로 둔다(부분 갱신 유지)', () => {
    const patch = { groups: [g('g2')] }
    expect(withInheritedLayout(null, patch)).toBe(patch)
  })

  it('그룹만 넘겨도 위치·화면이 함께 실린다 — 안 그러면 그림이 흩어진다', () => {
    const out = withInheritedLayout(base, { groups: [g('g2')] })
    expect(out.groups?.map((x) => x.id)).toEqual(['g2'])
    expect(out.positions).toEqual(base.positions)
    expect(out.viewport).toEqual(base.viewport)
  })

  it('위치만 넘겨도 그룹이 함께 실린다', () => {
    const out = withInheritedLayout(base, { positions: { 't:x': { x: 5, y: 5 } } })
    expect(out.positions).toEqual({ 't:x': { x: 5, y: 5 } })
    expect(out.groups).toEqual(base.groups)
  })

  it('명시로 비운 배치는 물려받은 값이 못 덮는다 — 자동 배치', () => {
    const out = withInheritedLayout(base, { positions: {}, viewport: null, groups: base.groups })
    expect(out.positions).toEqual({})
    expect(out.viewport).toBeNull()
    expect(out.groups).toEqual(base.groups)
  })

  it('화면(viewport)만 null 로 넘기면 위치는 물려받은 채로 지워진 화면만 반영한다', () => {
    const out = withInheritedLayout(base, { viewport: null })
    expect(out.viewport).toBeNull()
    expect(out.positions).toEqual(base.positions)
  })
})
