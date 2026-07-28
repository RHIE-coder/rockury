import { describe, it, expect } from 'vitest'
import { layoutNested, type LayoutNodeIn } from './layout'
import { BOX_PAD } from './types'

const n = (id: string, parentId: string | null = null): LayoutNodeIn => ({ id, parentId })

/** 두 사각형이 겹치나 (맞닿는 것은 겹침이 아니다). */
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('layoutNested — 겹 구조를 지키는 자동 배치', () => {
  it('CASE-iarch-010 한 겹 그래프에서 노드가 겹치지 않는다', () => {
    const nodes = [n('a'), n('b'), n('c'), n('d')]
    const r = layoutNested(nodes, [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' }
    ])
    const boxes = nodes.map((x) => r[x.id])
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j]), `${nodes[i].id}↔${nodes[j].id}`).toBe(false)
      }
    }
  })

  it('CASE-iarch-011 자식이 부모 박스 밖으로 나가지 않는다', () => {
    const nodes = [n('vpc'), n('s1', 'vpc'), n('s2', 'vpc')]
    const r = layoutNested(nodes, [{ source: 's1', target: 's2' }])
    const parent = r['vpc']
    for (const id of ['s1', 's2']) {
      const c = r[id]
      expect(c.x, id).toBeGreaterThanOrEqual(0)
      expect(c.y, id).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w, id).toBeLessThanOrEqual(parent.w)
      expect(c.y + c.h, id).toBeLessThanOrEqual(parent.h)
    }
  })

  it('CASE-iarch-011 세 겹 중첩도 각 층이 자기 부모 안에 담긴다', () => {
    const nodes = [n('vpc'), n('sub', 'vpc'), n('ec2a', 'sub'), n('ec2b', 'sub')]
    const r = layoutNested(nodes, [])
    const inside = (childId: string, parentId: string): void => {
      const c = r[childId]
      const p = r[parentId]
      expect(c.x, childId).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w, childId).toBeLessThanOrEqual(p.w)
      expect(c.y + c.h, childId).toBeLessThanOrEqual(p.h)
    }
    inside('sub', 'vpc')
    inside('ec2a', 'sub')
    inside('ec2b', 'sub')
    // 부모는 자식보다 확실히 크다.
    expect(r['vpc'].w).toBeGreaterThan(r['sub'].w)
  })

  it('CASE-iarch-012 부모가 다른 노드끼리의 간선이 겹 구조를 깨지 않는다', () => {
    const nodes = [n('vpcA'), n('a1', 'vpcA'), n('vpcB'), n('b1', 'vpcB')]
    const r = layoutNested(nodes, [{ source: 'a1', target: 'b1' }])
    expect(r['a1'].x + r['a1'].w).toBeLessThanOrEqual(r['vpcA'].w)
    expect(r['b1'].x + r['b1'].w).toBeLessThanOrEqual(r['vpcB'].w)
    // 최상위 두 박스는 서로 겹치지 않는다.
    expect(overlaps(r['vpcA'], r['vpcB'])).toBe(false)
  })

  it('CASE-iarch-012 겹을 가로지르는 간선이 최상위 배치에는 반영된다(연결된 컨테이너가 이어진다)', () => {
    const nodes = [n('vpcA'), n('a1', 'vpcA'), n('vpcB'), n('b1', 'vpcB'), n('lone')]
    const r = layoutNested(nodes, [{ source: 'a1', target: 'b1' }])
    // A→B 간선이 있으므로 두 컨테이너는 서로 다른 계층에 놓인다(LR 기준 x 가 다르다).
    expect(r['vpcA'].x).not.toBe(r['vpcB'].x)
    expect(r['lone']).toBeTruthy()
  })

  it('CASE-iarch-013 노드 0개·간선 0개·고립 노드에서도 좌표를 낸다', () => {
    expect(layoutNested([], [])).toEqual({})
    const only = layoutNested([n('a')], [])
    expect(only['a']).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
    const isolated = layoutNested([n('a'), n('b')], [])
    expect(Object.keys(isolated).sort()).toEqual(['a', 'b'])
  })

  it('CASE-iarch-013 없는 노드를 가리키는 간선이 있어도 던지지 않는다', () => {
    const r = layoutNested([n('a')], [{ source: 'a', target: '없음' }])
    expect(r['a']).toBeTruthy()
  })

  it('CASE-iarch-013 부모 참조가 끊긴 노드는 최상위로 취급한다(증발 금지)', () => {
    const r = layoutNested([n('a', '없는부모'), n('b')], [])
    expect(r['a']).toBeTruthy()
    expect(r['b']).toBeTruthy()
  })

  it('부모-자식 고리가 있어도 무한 재귀에 빠지지 않는다', () => {
    const r = layoutNested([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], [])
    expect(Object.keys(r).sort()).toEqual(['a', 'b'])
  })

  it('같은 입력이면 같은 결과다(배치가 실행마다 흔들리지 않는다)', () => {
    const nodes = [n('vpc'), n('s1', 'vpc'), n('s2', 'vpc')]
    const edges = [{ source: 's1', target: 's2' }]
    expect(layoutNested(nodes, edges)).toEqual(layoutNested(nodes, edges))
  })

  it('종류가 준 크기를 존중한다 — 넓은 노드가 부모를 넓힌다', () => {
    const narrow = layoutNested([n('p'), { id: 'c', parentId: 'p', w: 100, h: 40 }], [])
    const wide = layoutNested([n('p'), { id: 'c', parentId: 'p', w: 600, h: 40 }], [])
    expect(wide['p'].w).toBeGreaterThan(narrow['p'].w)
    expect(wide['c'].w).toBe(600)
    expect(wide['p'].w).toBeGreaterThanOrEqual(600 + BOX_PAD * 2)
  })
})
