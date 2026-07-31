import { beforeEach, describe, expect, it } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { rowKey, useDataStore } from './store'

/**
 * Data 스토어 커밋문 생성 순서(pending 버퍼 → SQL) 검증 — window/IPC 불필요(순수 상태→출력).
 * 순서 불변: 삭제 → 수정(삭제행 제외) → 삽입. PK 로 rowKey 매칭.
 */
const tableDef: TableDef = {
  id: 't:u',
  designId: 'd',
  name: 'u',
  comment: '',
  columns: [
    { id: 'c:u.id', name: 'id', type: 'int', nullable: false, defaultValue: null, comment: '' },
    { id: 'c:u.name', name: 'name', type: 'text', nullable: true, defaultValue: null, comment: '' }
  ],
  constraints: [{ id: 'k', kind: 'pk', name: 'pk', columns: [{ columnId: 'c:u.id' }] }]
}
const pk = ['id']
const rows = [
  { id: 1, name: 'a' },
  { id: 2, name: 'b' }
]

beforeEach(() => {
  useDataStore.setState({ table: 'u', columns: ['id', 'name'], rows, edits: {}, deletes: {}, inserts: [] })
})

describe('buildStatements 순서/규칙', () => {
  it('삭제→수정→삽입 순, 파라미터 바인드', () => {
    useDataStore.setState({
      edits: { [rowKey(pk, rows[0])]: { name: 'A' } },
      deletes: { [rowKey(pk, rows[1])]: true },
      inserts: [{ tempId: 'n0', values: { name: 'c' } }]
    })
    const stmts = useDataStore.getState().buildStatements('postgresql', tableDef)
    expect(stmts.map((s) => s.sql.split(' ')[0])).toEqual(['DELETE', 'UPDATE', 'INSERT'])
    expect(stmts[0].sql).toBe('DELETE FROM "u" WHERE "id" = $1')
    expect(stmts[0].params).toEqual([2])
    expect(stmts[1].sql).toBe('UPDATE "u" SET "name" = $1 WHERE "id" = $2')
    expect(stmts[1].params).toEqual(['A', 1])
  })

  it('삭제된 행은 수정문을 만들지 않는다', () => {
    const key = rowKey(pk, rows[0])
    useDataStore.setState({ edits: { [key]: { name: 'A' } }, deletes: { [key]: true } })
    const stmts = useDataStore.getState().buildStatements('postgresql', tableDef)
    expect(stmts.map((s) => s.sql.split(' ')[0])).toEqual(['DELETE'])
  })

  it('빈 pending → 문 없음', () => {
    expect(useDataStore.getState().buildStatements('mysql', tableDef)).toEqual([])
  })
})
