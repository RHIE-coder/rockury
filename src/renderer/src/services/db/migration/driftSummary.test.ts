import { describe, expect, it } from 'vitest'
import { detailDrift, groupDrift, summarizeDrift } from './driftSummary'
import type { SchemaDiff, TableDiff } from '../versions/diff'

const emptySummary = {
  tablesAdded: 0,
  tablesRemoved: 0,
  tablesModified: 0,
  columnsAdded: 0,
  columnsRemoved: 0,
  columnsModified: 0,
  constraintsAdded: 0,
  constraintsRemoved: 0,
  constraintsModified: 0
}

const table = (name: string, status: TableDiff['status']): TableDiff => ({
  id: `t:${name}`,
  name,
  status,
  tableChanges: [],
  columns: [],
  constraints: []
})

const diff = (over: Partial<typeof emptySummary>, tables: TableDiff[] = []): SchemaDiff => ({
  tables,
  summary: { ...emptySummary, ...over }
})

describe('summarizeDrift', () => {
  it('0 인 항목은 빼고 있는 것만 잇는다', () => {
    expect(summarizeDrift(diff({ tablesAdded: 2, columnsModified: 1 }))).toBe(
      '테이블 추가 2개 · 컬럼 변경 1개'
    )
  })

  it('변화가 없으면 빈 문자열 — 부를 쪽이 "남길 것 없음"을 가릴 수 있게', () => {
    expect(summarizeDrift(diff({}))).toBe('')
  })

  it('종류별 낱말을 가른다(추가·삭제·변경)', () => {
    expect(summarizeDrift(diff({ tablesRemoved: 1, constraintsAdded: 3 }))).toBe(
      '테이블 삭제 1개 · 제약 추가 3개'
    )
  })
})

describe('groupDrift', () => {
  it('종류마다 +/−/~ 세 숫자로 접는다', () => {
    expect(groupDrift(diff({ tablesAdded: 6, tablesModified: 18, columnsRemoved: 11 }))).toEqual([
      { label: '테이블', added: 6, removed: 0, modified: 18 },
      { label: '컬럼', added: 0, removed: 11, modified: 0 }
    ])
  })

  it('한 건도 없는 종류는 빼서 빈 칸이 자리를 먹지 않게', () => {
    expect(groupDrift(diff({ constraintsModified: 23 }))).toEqual([
      { label: '제약', added: 0, removed: 0, modified: 23 }
    ])
  })

  it('변화가 없으면 빈 배열 — 부를 쪽이 아무것도 안 그릴 수 있게', () => {
    expect(groupDrift(diff({}))).toEqual([])
  })
})

describe('detailDrift', () => {
  it('상태 기호를 붙여 테이블 이름을 나열한다', () => {
    const d = diff({}, [table('orders', 'added'), table('users', 'modified'), table('logs', 'removed')])
    expect(detailDrift(d)).toBe('+orders ~users -logs')
  })

  it('상한을 넘으면 잘라내고 몇 개가 남았는지 밝힌다', () => {
    const many = Array.from({ length: 5 }, (_, i) => table(`t${i}`, 'added'))
    expect(detailDrift(diff({}, many), 2)).toBe('+t0 +t1 … 외 3개')
  })

  it('변화가 없으면 빈 문자열', () => {
    expect(detailDrift(diff({}))).toBe('')
  })
})
