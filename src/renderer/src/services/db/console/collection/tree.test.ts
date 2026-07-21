import { describe, expect, it } from 'vitest'
import { flattenTree, getProjection, removeChildrenOf, type LibNode } from './tree'

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
})
