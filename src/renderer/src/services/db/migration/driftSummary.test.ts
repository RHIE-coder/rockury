import { describe, expect, it } from 'vitest'
import { groupDrift } from './driftSummary'
import type { SchemaDiff } from '../versions/diff'

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

const diff = (over: Partial<typeof emptySummary>): SchemaDiff => ({
  tables: [],
  summary: { ...emptySummary, ...over }
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
