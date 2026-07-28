import { describe, it, expect } from 'vitest'
import { FOCUS_MAX_ZOOM, focusTarget, searchNodes } from './search'
import type { DesignNode } from './types'
import { EMPTY_DOC, type NodeTypeDef } from '../catalog/types'

const node = (over: Partial<DesignNode> & { id: string; name: string }): DesignNode => ({
  designId: 'd1',
  typeId: null,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: EMPTY_DOC,
  ...over
})

const types: Record<string, NodeTypeDef> = {
  'aws.ec2': { id: 'aws.ec2', label: 'EC2 인스턴스', icon: 'phosphor:cube' },
  'aws.rds': { id: 'aws.rds', label: 'RDS', icon: 'phosphor:database' }
}

const nodes = [
  node({ id: '1', name: 'payment-api', typeId: 'aws.ec2' }),
  node({ id: '2', name: 'payment-db', typeId: 'aws.rds' }),
  node({ id: '3', name: '결제 큐', typeId: null }),
  node({ id: '4', name: 'api-gateway', typeId: 'aws.ec2' })
]

describe('searchNodes — 이름·종류로 찾는다', () => {
  it('빈 검색어면 아무것도 안 준다 — 전부 주면 목록이 소음이 된다', () => {
    expect(searchNodes(nodes, types, '')).toEqual([])
    expect(searchNodes(nodes, types, '   ')).toEqual([])
  })

  it('CASE-iarch-090 이름 일부로 찾는다', () => {
    expect(searchNodes(nodes, types, 'payment').map((n) => n.id)).toEqual(['1', '2'])
  })

  it('대소문자를 가리지 않는다', () => {
    expect(searchNodes(nodes, types, 'PAYMENT-API').map((n) => n.id)).toEqual(['1'])
  })

  it('CASE-iarch-090 종류 이름으로도 찾는다 — 이름을 모르고 "EC2 어디 있지"로 찾는 경우', () => {
    expect(searchNodes(nodes, types, 'EC2').map((n) => n.id)).toEqual(['1', '4'])
  })

  it('종류 id 로도 찾힌다(카탈로그를 아는 사람의 검색어)', () => {
    expect(searchNodes(nodes, types, 'aws.rds').map((n) => n.id)).toEqual(['2'])
  })

  it('이름이 맞은 것이 종류만 맞은 것보다 앞에 온다', () => {
    // 'ec2' 는 4번 이름에 없고 종류에만 있다. 이름에 'api' 가 든 1·4 중 …
    const r = searchNodes(nodes, types, 'api').map((n) => n.id)
    expect(r).toEqual(['1', '4'])
  })

  it('이름 맞음이 종류 맞음보다 먼저다', () => {
    const mixed = [
      node({ id: 'a', name: '무관한 이름', typeId: 'aws.rds' }), // 종류만 맞음
      node({ id: 'b', name: 'RDS 복제본', typeId: null }) // 이름이 맞음
    ]
    expect(searchNodes(mixed, types, 'rds').map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('한글 이름도 찾는다', () => {
    expect(searchNodes(nodes, types, '결제').map((n) => n.id)).toEqual(['3'])
  })

  it('맞는 것이 없으면 빈 배열(예외를 던지지 않는다)', () => {
    expect(searchNodes(nodes, types, 'zzz')).toEqual([])
  })

  it('카탈로그에서 사라진 종류를 가리켜도 이름 검색은 계속된다', () => {
    const orphan = [node({ id: 'x', name: 'ghost', typeId: 'gone.type' })]
    expect(searchNodes(orphan, types, 'ghost').map((n) => n.id)).toEqual(['x'])
  })
})

describe('focusTarget — 화면 가운데로 옮기기', () => {
  it('노드의 한가운데를 절대 좌표로 준다', () => {
    const r = focusTarget(nodes, '1', 1)
    expect(r).toEqual({ x: 100, y: 30, zoom: 1 })
  })

  it('중첩된 노드는 부모 좌표를 더한 절대 위치로 준다', () => {
    const nested = [
      node({ id: 'p', name: '박스', x: 400, y: 200, w: 300, h: 200 }),
      node({ id: 'c', name: '자식', parentId: 'p', x: 24, y: 32, w: 100, h: 40 })
    ]
    expect(focusTarget(nested, 'c', 1)).toEqual({ x: 474, y: 252, zoom: 1 })
  })

  it('확대 상한을 지킨다 — 너무 당겨서 한 노드만 화면을 채우지 않게', () => {
    expect(focusTarget(nodes, '1', 4)?.zoom).toBe(FOCUS_MAX_ZOOM)
  })

  it('이미 축소해 놓았으면 그 배율을 그대로 둔다 — 사용자의 시야를 뺏지 않는다', () => {
    expect(focusTarget(nodes, '1', 0.4)?.zoom).toBe(0.4)
  })

  it('없는 노드면 null — 화면이 엉뚱한 곳으로 튀지 않는다', () => {
    expect(focusTarget(nodes, '없음', 1)).toBeNull()
  })
})
