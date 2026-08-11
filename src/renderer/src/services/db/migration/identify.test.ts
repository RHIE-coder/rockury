import { describe, expect, it } from 'vitest'
import { diffDistance, identifyVersion, type VersionLike } from './identify'
import type { SchemaDiff } from '../versions/diff'
import { columnId, tableId } from '../ids'
import type { TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'

/**
 * 실 DB 를 흉내내는 테이블 — id 는 **역설계와 같은 스킴**으로 만든다(`db/ids`).
 * 손으로 지어낸 id 를 쓰면 경계 정렬이 제 일을 해도 짝이 안 맞아 테스트가 거짓으로 실패한다.
 */
const table = (name: string, cols: string[], id = tableId(undefined, name)): TableDef => ({
  id,
  designId: 'd1',
  name,
  comment: '',
  columns: cols.map((c) => ({
    id: columnId(undefined, name, c),
    name: c,
    type: 'int',
    nullable: false,
    defaultValue: null,
    comment: ''
  })) as TableDef['columns'],
  constraints: []
})

const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

describe('identifyVersion', () => {
  it('실제와 똑같은 버전을 찾아낸다', () => {
    const actual = snap([table('orders', ['id', 'total'])])
    const versions: VersionLike[] = [
      { number: 'v0.1.0', snapshot: snap([table('orders', ['id'])]) },
      { number: 'v0.2.0', snapshot: snap([table('orders', ['id', 'total'])]) }
    ]

    expect(identifyVersion(actual, versions).match).toBe('v0.2.0')
  })

  it('설계가 순번 id 를 써도 이름으로 짝을 맞춘다 — 경계 정렬이 빠지면 전부 "다름"이 된다', () => {
    const actual = snap([table('orders', ['id'])])
    const authored = snap([table('orders', ['id'], 'o1')])

    expect(identifyVersion(actual, [{ number: 'v0.1.0', snapshot: authored }]).match).toBe('v0.1.0')
  })

  it('일치가 없으면 match 는 null 이고, 가까운 순으로 줄 세운다', () => {
    const actual = snap([table('orders', ['id', 'total', 'memo'])])
    const versions: VersionLike[] = [
      // 테이블이 통째로 다른 쪽 — 가장 멀다
      { number: 'v0.1.0', snapshot: snap([table('users', ['id'])]) },
      // 컬럼 하나 차이 — 가장 가깝다
      { number: 'v0.3.0', snapshot: snap([table('orders', ['id', 'total'])]) }
    ]

    const r = identifyVersion(actual, versions)
    expect(r.match).toBeNull()
    expect(r.candidates[0].number).toBe('v0.3.0')
    expect(r.candidates[0].distance).toBeLessThan(r.candidates[1].distance)
  })

  it('버전이 하나도 없으면 빈 판정', () => {
    expect(identifyVersion(snap([]), [])).toEqual({ match: null, candidates: [] })
  })

  it('빈 실 DB 는 빈 버전과 일치한다 — 아직 아무것도 안 만든 상태도 하나의 상태다', () => {
    expect(identifyVersion(snap([]), [{ number: 'v0.1.0', snapshot: snap([]) }]).match).toBe('v0.1.0')
  })

  it('같은 거리면 먼저 넘어온 버전이 앞선다', () => {
    const actual = snap([table('orders', ['id'])])
    const versions: VersionLike[] = [
      { number: 'v0.1.0', snapshot: snap([table('orders', ['id', 'a'])]) },
      { number: 'v0.2.0', snapshot: snap([table('orders', ['id', 'b'])]) }
    ]

    expect(identifyVersion(actual, versions).candidates[0].number).toBe('v0.1.0')
  })
})

describe('diffDistance', () => {
  const withSummary = (over: Partial<SchemaDiff['summary']>): SchemaDiff => ({
    tables: [],
    summary: {
      tablesAdded: 0, tablesRemoved: 0, tablesModified: 0,
      columnsAdded: 0, columnsRemoved: 0, columnsModified: 0,
      constraintsAdded: 0, constraintsRemoved: 0, constraintsModified: 0,
      ...over
    }
  })

  it('차이가 없으면 0', () => {
    expect(diffDistance(withSummary({}))).toBe(0)
  })

  it('테이블 차이가 컬럼 차이보다 무겁다 — 통째로 다른 것과 한 칸 다른 것을 같게 볼 수 없다', () => {
    expect(diffDistance(withSummary({ tablesAdded: 1 }))).toBeGreaterThan(
      diffDistance(withSummary({ columnsAdded: 9 }))
    )
  })

  it('컬럼 차이가 제약 차이보다 무겁다', () => {
    expect(diffDistance(withSummary({ columnsAdded: 1 }))).toBeGreaterThan(
      diffDistance(withSummary({ constraintsAdded: 9 }))
    )
  })
})
