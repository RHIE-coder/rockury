import { describe, expect, it } from 'vitest'
import { diagnose, diagnosisState, hasAhead } from './diagnose'
import { columnId, tableId } from '../ids'
import type { TableDef } from '../workspaces/definition/types'
import type { SeedSet } from '../workspaces/seed/types'
import { diffSnapshots } from '../versions/diff'
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

describe('diagnose — 설계 버전끼리 잰다', () => {
  it('설계가 앞선 것을 센다', () => {
    const atRemote = snap([table('orders', ['id'])])
    const atTarget = snap([table('orders', ['id']), table('tags', ['id'])]) // 설계가 tags 를 더했다

    const d = diagnose({ atRemote, atTarget })

    expect(d.ahead?.schema.summary.tablesAdded).toBe(1) // tags
    expect(hasAhead(d)).toBe(true)
  })

  it('시드 차이도 "앞선 것"에 든다 — 설계 버전끼리라야 잴 수 있다', () => {
    const atRemote = snap([table('roles', ['code'])], [seedSet('roles', [{ code: 'admin' }])])
    const atTarget = snap(
      [table('roles', ['code'])],
      [seedSet('roles', [{ code: 'admin' }, { code: 'guest' }])]
    )

    const d = diagnose({ atRemote, atTarget })

    expect(d.ahead?.seed.summary.rowsAdded).toBe(1)
    expect(hasAhead(d)).toBe(true) // 스키마는 같아도 시드가 다르면 밀 것이 있다
  })

  it('Remote 버전을 모르면 앞선 것도 못 잰다', () => {
    const d = diagnose({ atRemote: null, atTarget: snap([table('orders', ['id'])]) })

    expect(d.ahead).toBeNull()
    expect(hasAhead(d)).toBe(false)
  })

  it('설계 버전끼리는 경계 정렬을 타지 않는다 — 순번 id 그대로 비교한다', () => {
    // 같은 계보의 두 버전은 id 가 안정적이라, 정렬 없이 붙어야 "변경 없음"이 나온다.
    const authored: VersionSnapshot = {
      tables: [{ ...table('orders', ['id']), id: 'o1', columns: [{ ...table('orders', ['id']).columns[0], id: 'c1' }] }]
    }

    const d = diagnose({ atRemote: authored, atTarget: authored })

    expect(hasAhead(d)).toBe(false)
  })
})

/**
 * 상태는 **지금 DB ↔ 설계** 하나로 갈린다. 예전엔 기준선(마지막으로 확인한 DB 모습)과 견준
 * `drifted` 가 하나 더 있었는데, 기준선을 걷어내면서(2026-08-12) 함께 사라졌다.
 */
describe('diagnosisState — 화면이 그릴 상태 하나로', () => {
  const same = diffSnapshots(snap([table('orders', ['id'])]), snap([table('orders', ['id'])]))
  const differs = diffSnapshots(snap([table('orders', ['id'])]), snap([table('orders', ['id']), table('tags', ['id'])]))

  it('맵핑 안 됐으면 다른 것을 보기 전에 unmapped', () => {
    expect(diagnosisState(false, differs)).toBe('unmapped')
  })

  it('지금 DB 가 설계와 다르면 different', () => {
    expect(diagnosisState(true, differs)).toBe('different')
  })

  it('같으면 synced', () => {
    expect(diagnosisState(true, same)).toBe('synced')
  })

  it('아직 잴 것이 없으면(타깃 없음) 없는 차이를 지어내지 않는다', () => {
    expect(diagnosisState(true, null)).toBe('synced')
  })
})
