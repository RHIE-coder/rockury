import { describe, expect, it, vi } from 'vitest'
import { toLibNodes, useCollectionStore } from './store'

/**
 * Collection 스토어의 트리 노드 매핑(folders+queries → LibNode) 검증 — 순수.
 * 폴더는 parentId, 쿼리는 folderId 를 부모로, kind 를 부여한다.
 */
describe('toLibNodes', () => {
  it('folders/queries 를 LibNode 로 매핑', () => {
    const nodes = toLibNodes(
      [{ id: 'f1', connectionId: 'c', designId: '', parentId: null, name: 'F', sortOrder: 0 }],
      [{ id: 'q1', connectionId: 'c', designId: '', folderId: 'f1', name: 'Q', description: '', sql: 'SELECT 1', sortOrder: 1 }]
    )
    expect(nodes).toEqual([
      { id: 'f1', parentId: null, kind: 'folder', name: 'F', sortOrder: 0 },
      { id: 'q1', parentId: 'f1', kind: 'query', name: 'Q', sql: 'SELECT 1', sortOrder: 1 }
    ])
  })
})

/**
 * 회귀(2026-08-12 유실 사고) — 자동저장이 저장소만 고치고 손에 든 트리 사본은 그대로 두면,
 * 그 쿼리를 다시 열 때 낡은 글이 편집기에 실리고 그게 저장소를 덮었다.
 */
describe('saveQuerySql', () => {
  it('저장소에 쓰고, 트리 사본의 sql 도 같은 값으로 맞춘다', async () => {
    const updateQuery = vi.fn(async () => {})
    ;(globalThis as unknown as { window: unknown }).window = { rockury: { savedQueries: { updateQuery } } }
    useCollectionStore.setState({
      queries: [
        { id: 'q1', connectionId: 'c', designId: '', folderId: null, name: 'Q1', description: '', sql: '', sortOrder: 0 },
        { id: 'q2', connectionId: 'c', designId: '', folderId: null, name: 'Q2', description: '', sql: '옛글', sortOrder: 1 }
      ]
    })

    await useCollectionStore.getState().saveQuerySql('q1', 'SELECT 1')

    expect(updateQuery).toHaveBeenCalledWith('q1', { sql: 'SELECT 1' })
    const qs = useCollectionStore.getState().queries
    expect(qs.find((q) => q.id === 'q1')?.sql).toBe('SELECT 1')
    // 남의 것은 안 건드린다.
    expect(qs.find((q) => q.id === 'q2')?.sql).toBe('옛글')
  })
})
