import { describe, expect, it } from 'vitest'
import type { EffectiveRow } from './effective'
import { diffGrants } from './diff'
import type { GrantSetItem } from './types'

/** CASE-remote-076 — 세트↔계정 대조. 판정 기준은 유효 권한이다. */

const TABLES = [
  { db: 'shop', table: 'orders' },
  { db: 'shop', table: 'customers' },
  { db: 'shop', table: 'graders' }
]

const row = (table: string, privs: EffectiveRow['privs']): EffectiveRow => ({ db: 'shop', table, privs })
const items = (over?: Partial<GrantSetItem>): GrantSetItem[] => [
  { pattern: 'orders', privileges: ['SELECT', 'INSERT'], ...over }
]

describe('diffGrants', () => {
  it('모자람과 넘침을 가른다', () => {
    const d = diffGrants(
      items(),
      TABLES,
      [row('orders', { SELECT: [{ layer: 'table' }], DELETE: [{ layer: 'table' }] })],
      'app@%'
    )
    expect(d.changes).toEqual([
      { account: 'app@%', db: 'shop', table: 'orders', privilege: 'INSERT', kind: 'missing' },
      { account: 'app@%', db: 'shop', table: 'orders', privilege: 'DELETE', kind: 'excess', layer: 'table' }
    ])
  })

  it('양쪽 개수를 항상 함께 돌려준다 — 0=0 은 "일치"가 아니라 "아무것도 대조되지 않음"', () => {
    const empty = diffGrants([{ pattern: 'tmp_*', privileges: ['SELECT'] }], TABLES, [], 'a')
    expect(empty.counts).toEqual({ patterns: 1, matchedTables: 0, expected: 0, actual: 0 })
    expect(empty.unmatchedPatterns).toEqual(['tmp_*'])
    expect(empty.changes).toEqual([])

    const some = diffGrants(items(), TABLES, [row('orders', { SELECT: [{ layer: 'table' }] })], 'a')
    expect(some.counts).toMatchObject({ patterns: 1, matchedTables: 1, expected: 2, actual: 1 })
  })

  it('판정은 유효 권한 — 전역·DB 층에서 내려오면 모자람이 아니다', () => {
    const d = diffGrants(items(), TABLES, [row('orders', { SELECT: [{ layer: 'global' }], INSERT: [{ layer: 'database' }] })], 'a')
    expect(d.changes.filter((c) => c.kind === 'missing')).toEqual([])
  })

  it('넘침의 출처가 위층이면 layer 로 표시된다 — REVOKE 후보 판정은 문장 생성기 몫', () => {
    const d = diffGrants(items({ privileges: ['SELECT'] }), TABLES, [
      row('orders', { SELECT: [{ layer: 'table' }], UPDATE: [{ layer: 'database' }, { layer: 'table' }] })
    ], 'a')
    const excess = d.changes.find((c) => c.kind === 'excess')!
    expect([excess.privilege, excess.layer]).toEqual(['UPDATE', 'database']) // 가장 넓은 층이 출처
  })

  it('세트가 못 담는 권한(공통분모 밖)은 넘침으로 세지 않는다 — 세트의 언어 밖이라 소음', () => {
    const d = diffGrants(items({ privileges: ['SELECT'] }), TABLES, [
      row('orders', { SELECT: [{ layer: 'table' }], TRUNCATE: [{ layer: 'table' }] })
    ], 'a')
    expect(d.changes).toEqual([])
  })

  it('패턴이 매칭한 표 전부에 세트 권한을 요구한다', () => {
    const d = diffGrants(
      [{ pattern: '*', privileges: ['SELECT'] }],
      TABLES,
      [row('orders', { SELECT: [{ layer: 'table' }] })],
      'a'
    )
    expect(d.changes.filter((c) => c.kind === 'missing').map((c) => c.table).sort()).toEqual([
      'customers',
      'graders'
    ])
    expect(d.counts.matchedTables).toBe(3)
  })

  it('대조 밖 — 세트가 안 겨눈 표의 권한은 changes 에 없고 개수로만 밝힌다', () => {
    const d = diffGrants(items(), TABLES, [
      row('orders', { SELECT: [{ layer: 'table' }], INSERT: [{ layer: 'table' }] }),
      row('customers', { DELETE: [{ layer: 'table' }] })
    ], 'a')
    expect(d.changes).toEqual([])
    expect(d.outsideCount).toBe(1)
  })
})
