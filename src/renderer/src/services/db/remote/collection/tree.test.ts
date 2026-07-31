import { describe, expect, it } from 'vitest'
import { flattenTree, folderDescendants, getProjection, moveTargets, removeChildrenOf, type LibNode } from './tree'

// f1 ├ q1
//    └ f2 ├ q2
// q3 (root)
const nodes: LibNode[] = [
  { id: 'f1', parentId: null, kind: 'folder', name: 'A', sortOrder: 0 },
  { id: 'q1', parentId: 'f1', kind: 'query', name: 'q1', sortOrder: 1, sql: '' },
  { id: 'f2', parentId: 'f1', kind: 'folder', name: 'B', sortOrder: 0 },
  { id: 'q2', parentId: 'f2', kind: 'query', name: 'q2', sortOrder: 0, sql: '' },
  { id: 'q3', parentId: null, kind: 'query', name: 'q3', sortOrder: 5, sql: '' }
]

describe('flattenTree', () => {
  it('DFS 순서 + depth (폴더 먼저)', () => {
    const flat = flattenTree(nodes)
    expect(flat.map((n) => `${n.id}@${n.depth}`)).toEqual(['f1@0', 'f2@1', 'q2@2', 'q1@1', 'q3@0'])
  })
})

describe('removeChildrenOf', () => {
  it('폴더 자손을 제거(드롭 방지)', () => {
    const flat = flattenTree(nodes)
    const ids = removeChildrenOf(flat, ['f1']).map((n) => n.id)
    expect(ids).toEqual(['f1', 'q3'])
  })
})

describe('getProjection', () => {
  it('depth 오프셋으로 형제 부모(f1)에 투영', () => {
    const flat = flattenTree(nodes)
    // q3(depth0)을 q1 위치로 +1 들여쓰기 → q1 의 형제(부모 f1)
    const p = getProjection(flat, 'q3', 'q1', 1)
    expect(p.depth).toBe(1)
    expect(p.parentId).toBe('f1')
  })

  it('부모가 쿼리로 잡히면 그 부모의 부모로 보정', () => {
    const flat = flattenTree(nodes)
    // q3 을 q2 아래로 깊게 밀어도 q2(쿼리)는 부모가 못 되므로 f2 로 보정
    const p = getProjection(flat, 'q3', 'q2', 5)
    expect(p.parentId).toBe('f2')
  })

  it('루트로 끌어올리면 parentId null', () => {
    const flat = flattenTree(nodes)
    const p = getProjection(flat, 'q1', 'q3', -5)
    expect(p.parentId).toBeNull()
  })

  // 회귀: 펼친 폴더의 "첫 자식" 위에 루트 아이템을 얹으면 예전엔 minDepth=next.depth 가
  // 하한을 올려 왼쪽으로 아무리 끌어도 폴더로만 잡혔다. 가로 드래그로 루트에 닿을 수 있어야 한다.
  it('폴더 첫 자식 위 + 왼쪽/제자리 드래그 → 루트(parentId null)', () => {
    // f1 ├ f2(폴더) └ q1(자식)  ·  q3(루트, 드래그 대상)
    const flat = flattenTree(nodes)
    // over=f2(f1 의 첫 자식, depth1). delta 0/음수면 루트로 내려갈 수 있어야 함.
    expect(getProjection(flat, 'q3', 'f2', 0).parentId).toBeNull()
    expect(getProjection(flat, 'q3', 'f2', -2).parentId).toBeNull()
  })

  it('폴더 첫 자식 위 + 오른쪽 드래그(+1) → 그 폴더로 중첩', () => {
    const flat = flattenTree(nodes)
    // over=f2(depth1), delta +1 → depth1, 부모는 이전 폴더 f1
    const p = getProjection(flat, 'q3', 'f2', 1)
    expect(p.depth).toBe(1)
    expect(p.parentId).toBe('f1')
  })
})

describe('folderDescendants', () => {
  it('폴더의 자손 폴더 집합(자기 제외)', () => {
    // f1 └ f2 (f2 는 f1 의 자손 폴더)
    expect([...folderDescendants(nodes, 'f1')]).toEqual(['f2'])
    expect([...folderDescendants(nodes, 'f2')]).toEqual([])
  })
})

describe('moveTargets', () => {
  it('리프(쿼리)는 모든 폴더 + 최상위 로 이동 가능', () => {
    const t = moveTargets(nodes, 'q3')
    expect(t.map((x) => [x.id, x.label])).toEqual([
      [null, '(최상위)'],
      ['f1', 'A'],
      ['f2', 'A / B'] // 중첩 경로 라벨
    ])
  })

  it('폴더는 자기 자신과 자손 폴더를 대상에서 제외(순환 방지)', () => {
    // f1 을 옮길 때: f1 자신 + 자손 f2 제외 → (최상위)만 남는다
    expect(moveTargets(nodes, 'f1').map((x) => x.id)).toEqual([null])
    // f2 를 옮길 때: f2 자신 제외 → 최상위 + f1
    expect(moveTargets(nodes, 'f2').map((x) => x.id)).toEqual([null, 'f1'])
  })
})
