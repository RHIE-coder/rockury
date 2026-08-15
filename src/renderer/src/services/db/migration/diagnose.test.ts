import { describe, expect, it } from 'vitest'
import { diagnose, diagnosisState, hasAhead, pickTargetVersion, shouldIdentify } from './diagnose'
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

describe('shouldIdentify — 판정을 물어야 하나', () => {
  const base = { identified: false, loading: false, askedPair: null, pair: 'c1:d1' }

  it('아무것도 없으면 묻는다', () => {
    expect(shouldIdentify(base)).toBe(true)
  })

  it('답이 이미 있으면 안 묻는다', () => {
    expect(shouldIdentify({ ...base, identified: true })).toBe(false)
  })

  it('이미 물어 본 짝이면 안 묻는다', () => {
    expect(shouldIdentify({ ...base, askedPair: 'c1:d1' })).toBe(false)
  })

  it('짝이 바뀌면 다시 묻는다', () => {
    expect(shouldIdentify({ ...base, askedPair: 'c1:d1', pair: 'c1:d2' })).toBe(true)
  })

  // 회귀(2026-08-14): 결속을 끊고 돌아오면 판이 뜨는 순간 진단이 이미 돌고 있다. 그때
  // 물음을 버리기만 하고 다시 묻지 않아 후보가 비었고, "기존 설계 연결하기"가 사라졌다.
  it('도는 중엔 미루지만, 끝나면 그때 묻는다', () => {
    expect(shouldIdentify({ ...base, loading: true })).toBe(false)
    expect(shouldIdentify({ ...base, loading: false })).toBe(true)
  })
})

describe('pickTargetVersion — 견줄 설계 버전 고르기', () => {
  const versions = ['v0.2.0', 'v0.1.0'] // 최신순

  it('대놓고 고른 것이 있으면 그것', () => {
    expect(pickTargetVersion({ explicit: 'v0.1.0', remembered: 'v0.2.0', versions })).toBe('v0.1.0')
  })

  it('아까 고른 것이 이 설계에 있으면 그것을 지킨다', () => {
    expect(pickTargetVersion({ remembered: 'v0.1.0', versions })).toBe('v0.1.0')
  })

  it('아무것도 없으면 최신(목록 맨 앞)', () => {
    expect(pickTargetVersion({ remembered: null, versions })).toBe('v0.2.0')
  })

  it('버전이 하나도 없으면 없다고 말한다', () => {
    expect(pickTargetVersion({ remembered: null, versions: [] })).toBe(null)
  })

  // 회귀(2026-08-14): 예전 식은 `기억 ?? 최신` 이라 빈 문자열이 "고른 값"으로 통과했다.
  // 한 번 비면 최신으로 못 돌아와 상태 줄이 영영 "버전 모름"이었다.
  it('빈 값이 눌어붙지 않는다 — 최신으로 되돌아온다', () => {
    expect(pickTargetVersion({ remembered: '', versions })).toBe('v0.2.0')
  })

  // 회귀: 기억은 창 하나에 하나뿐이라 설계를 갈아타면 남의 번호를 들고 간다.
  it('다른 설계의 번호는 안 들고 간다', () => {
    expect(pickTargetVersion({ remembered: 'v9.9.9', versions })).toBe('v0.2.0')
  })
})
