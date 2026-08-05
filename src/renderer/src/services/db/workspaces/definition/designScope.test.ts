import { describe, expect, it } from 'vitest'
import {
  changedDesignIds,
  draftTablesFromSnapshot,
  mergeDesignTables,
  newTableSchema,
  nextNewName,
  reconcileActiveTable,
  toTableRecord
} from './designScope'
import { scopedTables } from '../../scope'
import type { TableDef } from './types'

const t = (designId: string, id: string, name = id): TableDef => ({
  id,
  designId,
  name,
  comment: '',
  columns: [],
  constraints: []
})

describe('changedDesignIds — 설계 스코프 저장의 diff', () => {
  it('같은 참조면 빈 배열', () => {
    const list = [t('a', 'a1')]
    expect(changedDesignIds(list, list)).toEqual([])
  })

  it('한 설계의 테이블만 바뀌면 그 설계만 — 다른 설계는 저장 대상에서 빠진다', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const prev = [a1, b1]
    const next = [{ ...a1, name: 'renamed' }, b1] // a1 만 새 객체
    expect(changedDesignIds(prev, next)).toEqual(['a'])
  })

  it('추가·삭제도 그 설계만 짚는다', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    expect(changedDesignIds([a1, b1], [a1, b1, t('b', 'b2')])).toEqual(['b']) // 추가
    expect(changedDesignIds([a1, b1], [a1])).toEqual(['b']) // 마지막 테이블 삭제(비우기)도 감지
  })

  it('여러 설계가 동시에 바뀌면 전부', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const next = [{ ...a1 }, { ...b1 }]
    expect(changedDesignIds([a1, b1], next).sort()).toEqual(['a', 'b'])
  })

  it('새 설계의 첫 테이블도 감지', () => {
    const a1 = t('a', 'a1')
    expect(changedDesignIds([a1], [a1, t('c', 'c1')])).toEqual(['c'])
  })
})

describe('mergeDesignTables — 리하이드레이션 병합', () => {
  it('대상 설계 슬라이스만 교체, 다른 설계는 참조 그대로 보존', () => {
    const a1 = t('a', 'a1')
    const b1 = t('b', 'b1')
    const incoming = [t('a', 'a2', 'from-agent')]
    const merged = mergeDesignTables([a1, b1], 'a', incoming)
    expect(merged.map((x) => x.id).sort()).toEqual(['a2', 'b1'])
    expect(merged.find((x) => x.id === 'b1')).toBe(b1) // 참조 보존 → 불필요한 리렌더 없음
  })

  it('incoming 에 섞인 다른 설계 레코드는 무시(스코프 밖 오염 차단)', () => {
    const merged = mergeDesignTables([t('b', 'b1')], 'a', [t('a', 'a1'), t('b', 'evil')])
    expect(merged.map((x) => x.id).sort()).toEqual(['a1', 'b1'])
  })

  it('빈 incoming = 설계 비우기', () => {
    expect(mergeDesignTables([t('a', 'a1'), t('b', 'b1')], 'a', []).map((x) => x.id)).toEqual(['b1'])
  })
})

describe('reconcileActiveTable — 리하이드레이션 후 활성 테이블 재조정', () => {
  it('활성 테이블이 그대로 있으면 변경 없음', () => {
    const merged = [t('a', 'a1'), t('a', 'a2')]
    expect(reconcileActiveTable('a1', merged, merged)).toEqual({ changed: false, activeTableId: 'a1' })
  })

  it('활성 테이블이 사라지면 갱신된 설계의 첫 테이블로', () => {
    const incoming = [t('a', 'a2'), t('a', 'a3')]
    const merged = [t('b', 'b1'), ...incoming]
    // 편집 중이던 a1 이 에이전트 쓰기로 사라짐 → a2(첫 테이블)로 되돌림
    expect(reconcileActiveTable('a1', merged, incoming)).toEqual({ changed: true, activeTableId: 'a2' })
  })

  it('설계가 통째로 비워지면 빈 활성 id', () => {
    expect(reconcileActiveTable('a1', [t('b', 'b1')], [])).toEqual({ changed: true, activeTableId: '' })
  })

  it('활성 id 가 없으면(빈 문자열) 변경 없음', () => {
    expect(reconcileActiveTable('', [t('a', 'a1')], [t('a', 'a1')])).toEqual({ changed: false, activeTableId: '' })
  })

  it('다른 설계의 활성 테이블은 건드리지 않는다(그 설계는 병합에 남아있음)', () => {
    // 설계 a 를 리하이드레이트하지만 활성은 설계 b 의 b1 — merged 에 b1 이 남아 변경 없음
    const incoming = [t('a', 'a9')]
    const merged = [t('b', 'b1'), ...incoming]
    expect(reconcileActiveTable('b1', merged, incoming)).toEqual({ changed: false, activeTableId: 'b1' })
  })
})

describe('toTableRecord — 저장으로 내보내는 필드', () => {
  // 회귀(2026-08-03 실측): 저장 매핑에 schema 가 빠져 있어, 여러 스키마를 가져온 설계도
  // 화면이 한 번 저장하면 전부 기본 스키마로 뭉개졌다(앱을 다시 열면 auth.sessions → public.sessions).
  it('스키마를 함께 내보낸다', () => {
    expect(toTableRecord({ ...t('d1', 'x'), schema: 'auth' }).schema).toBe('auth')
  })

  it('뷰 표식과 본문도 잃지 않는다 — 기본값으로 채워 내보낸다', () => {
    const rec = toTableRecord({ ...t('d1', 'v'), isView: true, viewSql: 'SELECT 1' })
    expect(rec).toMatchObject({ isView: true, viewSql: 'SELECT 1' })
    expect(toTableRecord(t('d1', 'x'))).toMatchObject({ isView: false, viewSql: '' })
  })
})

describe('draftTablesFromSnapshot — 버전 스냅샷을 Draft 로 앉힌다', () => {
  // 스냅샷의 id 규칙이 출처마다 다르다: 설계부에서 컷하면 이미 `<설계>:` 접두가 붙어 있고,
  // 운영 DB 가져오기로 컷하면 실 DB 이름 기반이라 접두가 없다.
  it('접두가 없는 스냅샷(가져오기로 컷)에는 설계 접두를 붙인다', () => {
    const out = draftTablesFromSnapshot([{ ...t('d1', 't:public.users'), schema: 'public' }], 'd1')
    expect(out[0].id).toBe('d1:t:public.users')
  })

  it('이미 접두가 붙은 스냅샷(설계부에서 컷)은 그대로 둔다 — 두 번 붙으면 새 테이블로 둔갑한다', () => {
    const out = draftTablesFromSnapshot([t('d1', 'd1:t:users')], 'd1')
    expect(out[0].id).toBe('d1:t:users')
  })

  it('스키마를 잃지 않는다 — 되돌리는 목적 자체가 그것이다', () => {
    const out = draftTablesFromSnapshot([{ ...t('d1', 't:auth.sessions'), schema: 'auth' }], 'd1')
    expect(out[0].schema).toBe('auth')
  })

  it('다른 설계의 스냅샷을 앉혀도 소속을 이 설계로 고쳐 준다', () => {
    const out = draftTablesFromSnapshot([t('other', 't:users')], 'd1')
    expect(out[0].designId).toBe('d1')
    expect(out[0].id).toBe('d1:t:users')
  })

  it('목록 차례는 그대로', () => {
    const out = draftTablesFromSnapshot([t('d1', 't:a'), t('d1', 'd1:t:b'), t('d1', 't:c')], 'd1')
    expect(out.map((x) => x.name)).toEqual(['t:a', 'd1:t:b', 't:c'])
  })
})

describe('newTableSchema', () => {
  // 회귀 — 새 표·뷰가 스키마 없이 태어나면 범위를 켠 설계에서 화면에 안 뜬다(2026-08-04 제보).
  it('범위를 골랐으면 그 첫 스키마 — 지금 보고 있는 자리에 생긴다', () => {
    expect(newTableSchema(['entity'], ['entity', 'public'])).toBe('entity')
  })

  it('범위를 안 골랐고 쓰는 스키마가 하나면 그것 — 엉뚱한 묶음을 새로 안 만든다', () => {
    expect(newTableSchema([], ['auth'])).toBe('auth')
  })

  it('범위도 없고 스키마가 여럿이면 기본 스키마', () => {
    expect(newTableSchema([], ['auth', 'public'])).toBe('public')
  })

  it('빈 설계(첫 표)도 기본 스키마', () => {
    expect(newTableSchema([], [])).toBe('public')
  })

  it('무엇을 고르든 빈 값은 안 준다 — 빈 값이면 목록·다이어그램에서 걸러진다', () => {
    for (const [scope, used] of [
      [['entity'], []],
      [[], ['public']],
      [[], []]
    ] as [string[], string[]][]) {
      const schema = newTableSchema(scope, used)
      expect(schema, `scope=${scope} used=${used}`).toBeTruthy()
      // 실제 걸름 규칙에 그대로 먹여 본다 — "빈 값이 아니다"보다 이쪽이 증상에 가깝다.
      expect(scopedTables([{ schema }], scope)).toHaveLength(1)
    }
  })
})

describe('nextNewName', () => {
  const t = (id: string, name: string, designId = 'd1'): TableDef =>
    ({ id, designId, schema: 'public', name, comment: '', columns: [], constraints: [] }) as TableDef

  // 회귀: 2026-08-05. 이름 번호가 내부 id 카운터를 나눠 써서 한 번 만들 때마다 둘씩 뛰었다 —
  // 실 DB 에 `new_view_2, 4, 6 … 62` 로 31개가 쌓여 있었다(홀수가 사라진 것처럼 보인다).
  it('처음 만들면 1번', () => {
    expect(nextNewName([], 'd1', 'new_view')).toBe('new_view_1')
    expect(nextNewName([], 'd1', 'new_table')).toBe('new_table_1')
  })

  it('번호가 1씩 이어진다 — 건너뛰지 않는다', () => {
    const tables = [t('tbl-1', 'new_view_1'), t('tbl-3', 'new_view_2')]
    expect(nextNewName(tables, 'd1', 'new_view')).toBe('new_view_3')
  })

  it('표와 뷰는 따로 센다', () => {
    const tables = [t('tbl-1', 'new_view_1'), t('tbl-2', 'new_view_2')]
    expect(nextNewName(tables, 'd1', 'new_table')).toBe('new_table_1')
  })

  it('사람이 바꾼 이름은 안 센다', () => {
    const tables = [t('tbl-1', 'orders'), t('tbl-2', 'users'), t('tbl-3', 'new_view_1')]
    expect(nextNewName(tables, 'd1', 'new_view')).toBe('new_view_2')
  })

  it('다른 설계 것은 안 센다 — 설계마다 1번부터', () => {
    const tables = [t('tbl-1', 'new_view_7', 'other')]
    expect(nextNewName(tables, 'd1', 'new_view')).toBe('new_view_1')
  })

  it('중간이 비어도 최대 번호 다음을 쓴다 — 살아 있는 이름과 안 부딪힌다', () => {
    const tables = [t('tbl-1', 'new_view_1'), t('tbl-9', 'new_view_5')]
    expect(nextNewName(tables, 'd1', 'new_view')).toBe('new_view_6')
  })

  it('다 지우면 다시 1번', () => {
    expect(nextNewName([t('tbl-1', 'orders')], 'd1', 'new_view')).toBe('new_view_1')
  })
})
