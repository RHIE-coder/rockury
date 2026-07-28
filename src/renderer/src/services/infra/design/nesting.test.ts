import { describe, it, expect } from 'vitest'
import { canNest, wouldCycle, absolutePos, fitParentSize, descendantIds } from './nesting'
import { BOX_HEADER, BOX_PAD, type DesignNode } from './types'
import { EMPTY_DOC, type NodeTypeDef } from '../catalog/types'

const types: Record<string, NodeTypeDef> = {
  vpc: { id: 'vpc', label: 'VPC', icon: 'phosphor:cloud' },
  subnet: { id: 'subnet', label: '서브넷', icon: 'phosphor:rectangle', canNestIn: ['vpc'] },
  ec2: { id: 'ec2', label: 'EC2', icon: 'phosphor:hard-drives', canNestIn: ['subnet'] },
  // 일반 상자 — 자식이 자기를 등재할 수 없으므로 부모 쪽에서 허가한다.
  box: { id: 'box', label: '묶음 상자', icon: 'phosphor:rectangle', canContain: ['*'] },
  host: { id: 'host', label: '서버', icon: 'phosphor:hard-drive', canContain: ['ec2'] }
}

const node = (p: Partial<DesignNode> & { id: string }): DesignNode => ({
  designId: 'd1',
  typeId: null,
  name: p.id,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: { ...EMPTY_DOC },
  ...p
})

describe('canNest — 중첩 규칙', () => {
  it('CASE-iarch-001 canNestIn 이 허용하는 부모에만 들어간다', () => {
    expect(canNest('subnet', 'vpc', types).ok).toBe(true)
    expect(canNest('ec2', 'subnet', types).ok).toBe(true)
  })

  it('CASE-iarch-001 허용 안 되면 이유를 준다 — 조용히 튕기지 않는다', () => {
    const r = canNest('ec2', 'vpc', types)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('EC2')
    expect(r.reason).toContain('서브넷') // 허용된 부모를 알려 준다
  })

  it('CASE-iarch-001 canNestIn 이 없는 종류는 최상위 전용이다', () => {
    const r = canNest('vpc', 'subnet', types)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('최상위')
  })

  it('최상위(부모 없음)로 놓는 것은 언제나 된다', () => {
    expect(canNest('ec2', null, types).ok).toBe(true)
    expect(canNest('vpc', null, types).ok).toBe(true)
  })

  it('종류 없는 맨 노드는 규칙이 없으므로 어디든 들어간다 — 그리기를 막지 않는다', () => {
    expect(canNest(null, 'vpc', types).ok).toBe(true)
    expect(canNest('ec2', null, types).ok).toBe(true)
  })

  it('부모가 `canContain: ["*"]` 이면 무엇이든 담는다 — 묶음 상자가 성립한다', () => {
    expect(canNest('vpc', 'box', types).ok).toBe(true)
    expect(canNest('ec2', 'box', types).ok).toBe(true)
  })

  it('부모가 특정 종류만 담겠다고 하면 그것만 들어간다', () => {
    expect(canNest('ec2', 'host', types).ok).toBe(true)
    const r = canNest('subnet', 'host', types)
    expect(r.ok).toBe(false)
  })

  it('부모 허가가 자식 규칙보다 먼저다 — 자식이 최상위 전용이어도 담긴다', () => {
    // vpc 는 canNestIn 이 없어 원래 최상위 전용이지만, 묶음 상자는 부모 쪽에서 허가한다.
    expect(canNest('vpc', 'box', types).ok).toBe(true)
    expect(canNest('vpc', 'subnet', types).ok).toBe(false)
  })

  it('카탈로그에서 사라진 종류를 가리켜도 던지지 않고 허용한다(노드를 못 옮기게 만들지 않는다)', () => {
    expect(canNest('없어진종류', 'vpc', types).ok).toBe(true)
    expect(canNest('ec2', '없어진종류', types).ok).toBe(true)
  })
})

describe('wouldCycle — 자기 안으로 들어가기 방지', () => {
  const nodes = [
    node({ id: 'a' }),
    node({ id: 'b', parentId: 'a' }),
    node({ id: 'c', parentId: 'b' }),
    node({ id: 'x' })
  ]

  it('CASE-iarch-002 자기 자신을 부모로 삼을 수 없다', () => {
    expect(wouldCycle(nodes, 'a', 'a')).toBe(true)
  })

  it('CASE-iarch-002 자기 자손을 부모로 삼을 수 없다', () => {
    expect(wouldCycle(nodes, 'a', 'b')).toBe(true)
    expect(wouldCycle(nodes, 'a', 'c')).toBe(true)
  })

  it('CASE-iarch-002 남의 자식으로 들어가는 것은 된다', () => {
    expect(wouldCycle(nodes, 'x', 'c')).toBe(false)
    expect(wouldCycle(nodes, 'c', 'x')).toBe(false)
  })

  it('최상위로 빼는 것은 언제나 된다', () => {
    expect(wouldCycle(nodes, 'c', null)).toBe(false)
  })

  it('descendantIds 는 자기 자신을 포함한 자손 전부를 준다', () => {
    expect([...descendantIds(nodes, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect([...descendantIds(nodes, 'x')]).toEqual(['x'])
  })
})

describe('absolutePos — 상대 좌표를 캔버스 좌표로', () => {
  it('CASE-iarch-004 부모를 옮기면 자식의 절대 좌표가 같은 만큼 따라온다', () => {
    const before = [node({ id: 'p', x: 100, y: 100 }), node({ id: 'c', parentId: 'p', x: 30, y: 40 })]
    const after = before.map((n) => (n.id === 'p' ? { ...n, x: 300, y: 250 } : n))

    expect(absolutePos(before, 'c')).toEqual({ x: 130, y: 140 })
    expect(absolutePos(after, 'c')).toEqual({ x: 330, y: 290 })

    // 상대 좌표는 그대로다 — 자식을 건드리지 않고 부모만 옮겼다.
    expect(after.find((n) => n.id === 'c')!.x).toBe(30)
  })

  it('세 겹 중첩도 누적된다', () => {
    const nodes = [
      node({ id: 'a', x: 10, y: 10 }),
      node({ id: 'b', parentId: 'a', x: 20, y: 20 }),
      node({ id: 'c', parentId: 'b', x: 5, y: 5 })
    ]
    expect(absolutePos(nodes, 'c')).toEqual({ x: 35, y: 35 })
  })

  it('부모가 사라진 노드는 자기 좌표를 그대로 쓴다(끊긴 참조에 크래시하지 않는다)', () => {
    const nodes = [node({ id: 'c', parentId: '없음', x: 7, y: 8 })]
    expect(absolutePos(nodes, 'c')).toEqual({ x: 7, y: 8 })
  })
})

describe('fitParentSize — 자식이 늘면 부모가 커진다', () => {
  it('CASE-iarch-003 자식을 모두 감싸는 크기를 낸다(여백·제목줄 포함)', () => {
    const children = [
      node({ id: 'c1', parentId: 'p', x: BOX_PAD, y: BOX_HEADER, w: 200, h: 60 }),
      node({ id: 'c2', parentId: 'p', x: BOX_PAD, y: BOX_HEADER + 100, w: 300, h: 60 })
    ]
    const size = fitParentSize(children)
    expect(size.w).toBe(BOX_PAD + 300 + BOX_PAD)
    expect(size.h).toBe(BOX_HEADER + 100 + 60 + BOX_PAD)
  })

  it('CASE-iarch-003 자식이 없으면 최소 크기다', () => {
    const size = fitParentSize([])
    expect(size.w).toBeGreaterThan(0)
    expect(size.h).toBeGreaterThan(0)
  })

  it('CASE-iarch-003 자식이 늘면 커지고, 줄면 작아진다', () => {
    const one = fitParentSize([node({ id: 'c1', x: 0, y: 0, w: 200, h: 60 })])
    const two = fitParentSize([
      node({ id: 'c1', x: 0, y: 0, w: 200, h: 60 }),
      node({ id: 'c2', x: 0, y: 200, w: 200, h: 60 })
    ])
    expect(two.h).toBeGreaterThan(one.h)
  })
})
