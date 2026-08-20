import { describe, expect, it } from 'vitest'
import type { SeedRow, SeedSet } from '../workspaces/seed/types'
import { diffSeeds, isEmptySeedDiff } from './seedDiff'


const row = (id: string, values: Record<string, string | null>): SeedRow => ({ id, values })

const set = (over: Partial<SeedSet> = {}): SeedSet => ({
  designId: 'd1',
  tableName: 'roles',
  naturalKey: ['code'],
  ignoredColumns: [],
  strength: 'ensure',
  rows: [],
  ...over
})

describe('CASE-design-020 세트 단위 차이', () => {
  it('세트 추가를 잡고 행 수를 추가로 센다', () => {
    const d = diffSeeds([], [set({ rows: [row('r1', { code: 'admin' }), row('r2', { code: 'viewer' })] })])
    expect(d.sets).toHaveLength(1)
    expect(d.sets[0]).toMatchObject({ tableName: 'roles', status: 'added' })
    expect(d.summary).toMatchObject({ setsAdded: 1, rowsAdded: 2 })
  })

  it('세트 삭제를 잡는다', () => {
    const d = diffSeeds([set({ rows: [row('r1', { code: 'admin' })] })], [])
    expect(d.sets[0]).toMatchObject({ tableName: 'roles', status: 'removed' })
    expect(d.summary).toMatchObject({ setsRemoved: 1, rowsRemoved: 1 })
  })

  it('양쪽 같으면 아무 델타도 없다', () => {
    const a = set({ rows: [row('r1', { code: 'admin', name: '관리자' })] })
    const b = set({ rows: [row('x9', { code: 'admin', name: '관리자' })] })
    const d = diffSeeds([a], [b])
    expect(isEmptySeedDiff(d)).toBe(true)
  })

  it('여러 세트는 추가 → 변경 → 삭제 순으로 보인다', () => {
    const base = [set({ tableName: 'gone' }), set({ tableName: 'kept', rows: [row('b', { code: 'a' })] })]
    const target = [set({ tableName: 'kept' }), set({ tableName: 'fresh' })]
    const d = diffSeeds(base, target)
    expect(d.sets.map((s) => [s.tableName, s.status])).toEqual([
      ['fresh', 'added'],
      ['kept', 'modified'],
      ['gone', 'removed']
    ])
  })
})

describe('CASE-design-021 행 단위 차이', () => {
  it('행 추가·삭제·값 변경을 잡는다', () => {
    const base = [set({ rows: [row('b1', { code: 'admin', name: '관리자' }), row('b2', { code: 'gone', name: '없어짐' })] })]
    const target = [set({ rows: [row('t1', { code: 'admin', name: '최고 관리자' }), row('t2', { code: 'new', name: '신규' })] })]
    const d = diffSeeds(base, target)
    const rows = d.sets[0].rows
    expect(rows.map((r) => [r.label, r.status])).toEqual([
      ['admin', 'modified'],
      ['gone', 'removed'],
      ['new', 'added']
    ])
    expect(rows[0].changes).toEqual([{ field: 'name', before: '관리자', after: '최고 관리자' }])
    expect(d.summary).toMatchObject({ setsModified: 1, rowsAdded: 1, rowsRemoved: 1, rowsModified: 1 })
  })

  it('NULL ↔ 값 변경도 차이다(표기는 NULL)', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'a', memo: null })] })],
      [set({ rows: [row('t1', { code: 'a', memo: 'hi' })] })]
    )
    expect(d.sets[0].rows[0].changes).toEqual([{ field: 'memo', before: 'NULL', after: 'hi' }])
  })

  it('한쪽에만 있는 컬럼도 차이로 잡는다', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'a' })] })],
      [set({ rows: [row('t1', { code: 'a', extra: 'x' })] })]
    )
    expect(d.sets[0].rows[0].changes).toEqual([{ field: 'extra', before: 'NULL', after: 'x' }])
  })
})

describe('CASE-design-022 무시 컬럼 제외', () => {
  it('무시 컬럼 값만 다른 행은 차이가 아니다', () => {
    const d = diffSeeds(
      [set({ ignoredColumns: ['id', 'created_at'], rows: [row('b1', { code: 'a', id: '1', created_at: '2024' })] })],
      [set({ ignoredColumns: ['id', 'created_at'], rows: [row('t1', { code: 'a', id: '99', created_at: '2026' })] })]
    )
    expect(isEmptySeedDiff(d)).toBe(true)
  })

  it('무시 기준은 이후(target) 선언이다 — 새로 무시로 정하면 과거 차이도 조용해진다', () => {
    const d = diffSeeds(
      [set({ ignoredColumns: [], rows: [row('b1', { code: 'a', id: '1' })] })],
      [set({ ignoredColumns: ['id'], rows: [row('t1', { code: 'a', id: '99' })] })]
    )
    // 선언 변경은 잡히지만 행 값 차이는 무시된다
    expect(d.sets[0].declarationChanges).toEqual([{ field: '무시 컬럼', before: '—', after: 'id' }])
    expect(d.sets[0].rows).toEqual([])
  })
})

describe('CASE-design-023 변수 이름 비교', () => {
  it('같은 변수 이름끼리는 차이가 아니다(공백 표기 차이 포함)', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'admin', pw: '{{ADMIN_PASSWORD_HASH}}' })] })],
      [set({ rows: [row('t1', { code: 'admin', pw: '{{ ADMIN_PASSWORD_HASH }}' })] })]
    )
    expect(isEmptySeedDiff(d)).toBe(true)
  })

  it('변수 이름이 바뀌면 차이다', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'admin', pw: '{{OLD_HASH}}' })] })],
      [set({ rows: [row('t1', { code: 'admin', pw: '{{NEW_HASH}}' })] })]
    )
    expect(d.sets[0].rows[0].changes).toEqual([
      { field: 'pw', before: '{{OLD_HASH}}', after: '{{NEW_HASH}}' }
    ])
  })

  it('변수 → 평문(값 박아넣기)도 차이다', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'a', pw: '{{H}}' })] })],
      [set({ rows: [row('t1', { code: 'a', pw: 'plaintext' })] })]
    )
    expect(d.sets[0].rows[0].changes).toHaveLength(1)
  })
})

describe('CASE-design-024 선언 변경', () => {
  it("짝짓기 기준·무시 컬럼·'설계에 없는 행' 처리 변경을 잡는다", () => {
    const d = diffSeeds(
      [set({ naturalKey: ['code'], ignoredColumns: [], strength: 'ensure' })],
      [set({ naturalKey: ['code', 'org'], ignoredColumns: ['id'], strength: 'authoritative' })]
    )
    expect(d.sets[0].declarationChanges).toEqual([
      { field: '짝짓기 기준', before: 'code', after: 'code, org' },
      { field: '무시 컬럼', before: '—', after: 'id' },
      { field: '설계에 없는 행', before: '그대로 둠', after: '삭제 후보' }
    ])
    expect(d.summary.setsModified).toBe(1)
  })
})

describe('CASE-design-025 옛 스냅샷 폴백', () => {
  it('seeds 없는(undefined) 스냅샷은 빈 목록으로 읽는다', () => {
    expect(isEmptySeedDiff(diffSeeds(undefined, undefined))).toBe(true)
  })

  it('한쪽만 시드가 있으면 전부 추가/삭제로 잡는다', () => {
    const s = [set({ rows: [row('r1', { code: 'a' })] })]
    expect(diffSeeds(undefined, s).summary).toMatchObject({ setsAdded: 1, rowsAdded: 1 })
    expect(diffSeeds(s, undefined).summary).toMatchObject({ setsRemoved: 1, rowsRemoved: 1 })
  })
})

describe('CASE-design-026 자연키 없는 세트', () => {
  it('행 단위로 비교하지 않는다 — 행을 근거 없이 추가/삭제로 부풀리지 않는다', () => {
    const d = diffSeeds(
      [set({ naturalKey: [], rows: [row('b1', { code: 'a' })] })],
      [set({ naturalKey: [], rows: [row('t1', { code: 'b' })] })]
    )
    expect(d.sets[0]).toMatchObject({ comparable: false, rows: [] })
    expect(d.summary).toMatchObject({ rowsAdded: 0, rowsRemoved: 0, rowsModified: 0 })
  })

  it('내용이 완전히 같으면 조용하다', () => {
    const rows = [row('r', { code: 'a' })]
    expect(isEmptySeedDiff(diffSeeds([set({ naturalKey: [], rows })], [set({ naturalKey: [], rows })]))).toBe(true)
  })

  it('비교는 못 해도 행 내용이 다르면 침묵하지 않는다 — 세트를 변경으로 올리고 비교 불가로 표시', () => {
    const d = diffSeeds(
      [set({ naturalKey: [], rows: [row('b1', { code: 'a' })] })],
      [set({ naturalKey: [], rows: [row('t1', { code: 'a' }), row('t2', { code: 'b' })] })]
    )
    expect(d.sets).toHaveLength(1)
    expect(d.sets[0]).toMatchObject({ status: 'modified', comparable: false, rows: [] })
    expect(d.summary.setsModified).toBe(1)
  })

  it('행 로컬 id 만 다르면(내용 동일) 조용하다', () => {
    const d = diffSeeds(
      [set({ naturalKey: [], rows: [row('b1', { code: 'a' })] })],
      [set({ naturalKey: [], rows: [row('zz9', { code: 'a' })] })]
    )
    expect(isEmptySeedDiff(d)).toBe(true)
  })

  it('자연키 선언이 양쪽에서 다르면 행 비교를 건너뛰고 선언 변경만 보고한다', () => {
    const d = diffSeeds(
      [set({ naturalKey: ['code'], rows: [row('b1', { code: 'a' })] })],
      [set({ naturalKey: ['org'], rows: [row('t1', { org: 'x' })] })]
    )
    expect(d.sets[0].comparable).toBe(false)
    expect(d.sets[0].rows).toEqual([])
    expect(d.sets[0].declarationChanges).toHaveLength(1)
  })
})

describe('CASE-design-027 요약 집계', () => {
  it('시드 변경만 있어도 비어 있지 않다', () => {
    const d = diffSeeds(
      [set({ rows: [row('b1', { code: 'a', name: '이전' })] })],
      [set({ rows: [row('t1', { code: 'a', name: '이후' })] })]
    )
    expect(isEmptySeedDiff(d)).toBe(false)
    expect(d.summary.rowsModified).toBe(1)
  })
})
