import { describe, expect, it } from 'vitest'
import { diagnose, diagnosisState, hasAhead, hasDrift } from './diagnose'
import { columnId, tableId } from '../ids'
import type { TableDef } from '../workspaces/definition/types'
import type { SeedSet } from '../workspaces/seed/types'
import type { VersionSnapshot } from '../versions/store'

const table = (name: string, cols: string[]): TableDef => ({
  id: tableId(undefined, name),
  designId: 'd1',
  name,
  comment: '',
  columns: cols.map((c) => ({
    id: columnId(undefined, name, c),
    name: c,
    type: 'int',
    nullable: true,
    defaultValue: null,
    comment: ''
  })) as TableDef['columns'],
  constraints: []
})

const seedSet = (tableName: string, rows: Record<string, unknown>[]): SeedSet => ({
  designId: 'd1',
  tableName,
  naturalKey: ['code'],
  ignoredColumns: [],
  strength: 'ensure',
  rows: rows.map((values, i) => ({ id: `r${i}`, values })) as SeedSet['rows']
})

const snap = (tables: TableDef[], seeds?: SeedSet[]): VersionSnapshot => ({ tables, seeds })

describe('diagnose — 두 갈래로 가른다', () => {
  it('설계가 앞선 것과 DB 가 샌 것을 따로 센다', () => {
    const atRemote = snap([table('orders', ['id'])])
    const atTarget = snap([table('orders', ['id']), table('tags', ['id'])]) // 설계가 tags 를 더했다
    const baseline = snap([table('orders', ['id'])])
    const actual = snap([table('orders', ['id']), table('probe', ['id'])]) // 남이 probe 를 만들었다

    const d = diagnose({ atRemote, atTarget, baseline, actual })

    expect(d.ahead?.schema.summary.tablesAdded).toBe(1) // tags
    expect(d.drift?.summary.tablesAdded).toBe(1) // probe
    expect(hasAhead(d)).toBe(true)
    expect(hasDrift(d)).toBe(true)
  })

  it('시드 차이도 "앞선 것"에 든다 — 설계 버전끼리라야 잴 수 있다', () => {
    const atRemote = snap([table('roles', ['code'])], [seedSet('roles', [{ code: 'admin' }])])
    const atTarget = snap(
      [table('roles', ['code'])],
      [seedSet('roles', [{ code: 'admin' }, { code: 'guest' }])]
    )

    const d = diagnose({ atRemote, atTarget, baseline: null, actual: snap([]) })

    expect(d.ahead?.seed.summary.rowsAdded).toBe(1)
    expect(hasAhead(d)).toBe(true) // 스키마는 같아도 시드가 다르면 밀 것이 있다
  })

  it('기준선이 없으면 드리프트는 null — 견줄 대상이 없으면 "샜다"고 말할 수 없다', () => {
    const d = diagnose({
      atRemote: null,
      atTarget: null,
      baseline: null,
      actual: snap([table('orders', ['id'])])
    })

    expect(d.drift).toBeNull()
    expect(hasDrift(d)).toBe(false)
  })

  it('Remote 버전을 모르면 앞선 것도 못 잰다', () => {
    const d = diagnose({
      atRemote: null,
      atTarget: snap([table('orders', ['id'])]),
      baseline: snap([]),
      actual: snap([])
    })

    expect(d.ahead).toBeNull()
    expect(hasAhead(d)).toBe(false)
  })

  it('설계 버전끼리는 경계 정렬을 타지 않는다 — 순번 id 그대로 비교한다', () => {
    // 같은 계보의 두 버전은 id 가 안정적이라, 정렬 없이 붙어야 "변경 없음"이 나온다.
    const authored: VersionSnapshot = {
      tables: [{ ...table('orders', ['id']), id: 'o1', columns: [{ ...table('orders', ['id']).columns[0], id: 'c1' }] }]
    }

    const d = diagnose({ atRemote: authored, atTarget: authored, baseline: null, actual: snap([]) })

    expect(hasAhead(d)).toBe(false)
  })
})

describe('diagnosisState — 화면이 그릴 상태 하나로', () => {
  const clean = diagnose({ atRemote: snap([]), atTarget: snap([]), baseline: snap([]), actual: snap([]) })

  it('맵핑 안 됐으면 다른 것을 보기 전에 unmapped', () => {
    expect(diagnosisState(clean, false)).toBe('unmapped')
  })

  it('샌 것이 있으면 밀 것이 있어도 drifted 가 먼저 — 그 상태로 밀면 남의 변경을 덮는다', () => {
    const d = diagnose({
      atRemote: snap([]),
      atTarget: snap([table('tags', ['id'])]), // 밀 것도 있고
      baseline: snap([]),
      actual: snap([table('probe', ['id'])]) // 샌 것도 있다
    })

    expect(hasAhead(d)).toBe(true)
    expect(diagnosisState(d, true)).toBe('drifted')
  })

  it('깨끗하고 밀 것만 있으면 ahead', () => {
    const d = diagnose({
      atRemote: snap([]),
      atTarget: snap([table('tags', ['id'])]),
      baseline: snap([]),
      actual: snap([])
    })

    expect(diagnosisState(d, true)).toBe('ahead')
  })

  it('둘 다 없으면 synced', () => {
    expect(diagnosisState(clean, true)).toBe('synced')
  })
})
