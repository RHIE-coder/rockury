import { describe, expect, it } from 'vitest'
import { groupHistory, type HistoryGroup } from './historyGroup'
import type { HistoryRow } from './query/store'

function row(p: Partial<HistoryRow> & { id: string; createdAt: string }): HistoryRow {
  return {
    connectionId: 'c',
    source: 'query',
    sql: 'SELECT 1',
    kind: 'read',
    status: 'success',
    rowCount: 0,
    affectedRows: null,
    execMs: null,
    error: '',
    collectionId: null,
    collectionName: null,
    runId: null,
    seq: null,
    ...p
  }
}

describe('groupHistory', () => {
  it('runId 가 같은 컬렉션 실행을 한 그룹으로 묶고, 내부는 seq 오름차순', () => {
    // 입력은 최신순(DESC): seq 3 → 2 → 1 순으로 들어온다.
    const rows = [
      row({ id: 'a3', createdAt: '2026-01-01T00:00:03Z', source: 'collection', runId: 'R', collectionName: 'C', seq: 3, rowCount: 5 }),
      row({ id: 'a2', createdAt: '2026-01-01T00:00:02Z', source: 'collection', runId: 'R', collectionName: 'C', seq: 2, rowCount: 3 }),
      row({ id: 'a1', createdAt: '2026-01-01T00:00:01Z', source: 'collection', runId: 'R', collectionName: 'C', seq: 1, rowCount: 2 })
    ]
    const entries = groupHistory(rows)
    expect(entries).toHaveLength(1)
    const g = entries[0] as HistoryGroup
    expect(g.kind).toBe('group')
    expect(g.collectionName).toBe('C')
    expect(g.rows.map((r) => r.seq)).toEqual([1, 2, 3]) // 내부 정렬
    expect(g.totalRows).toBe(10)
    expect(g.ok).toBe(true)
  })

  it('runId 없는 실행은 단일 행', () => {
    const entries = groupHistory([row({ id: 'q1', createdAt: 't', source: 'query' })])
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('single')
  })

  it('그룹과 단일이 섞여도 최신순 위치를 보존', () => {
    const rows = [
      row({ id: 'q', createdAt: 't5', source: 'query' }),
      row({ id: 'r2', createdAt: 't4', source: 'collection', runId: 'R', seq: 2 }),
      row({ id: 'r1', createdAt: 't3', source: 'collection', runId: 'R', seq: 1 }),
      row({ id: 'd', createdAt: 't2', source: 'data' })
    ]
    const entries = groupHistory(rows)
    expect(entries.map((e) => e.kind)).toEqual(['single', 'group', 'single'])
    expect((entries[1] as HistoryGroup).rows).toHaveLength(2)
  })

  it('그룹에 실패가 하나라도 있으면 ok=false', () => {
    const rows = [
      row({ id: 'r2', createdAt: 't2', source: 'collection', runId: 'R', seq: 2, status: 'error' }),
      row({ id: 'r1', createdAt: 't1', source: 'collection', runId: 'R', seq: 1 })
    ]
    expect((groupHistory(rows)[0] as HistoryGroup).ok).toBe(false)
  })
})
