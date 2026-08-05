import { describe, expect, it } from 'vitest'
import { toLibNodes } from './store'

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
