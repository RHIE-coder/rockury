import { describe, expect, it } from 'vitest'
import type { Constraint, TableDef } from '../definition/types'
import { planSeedImport } from './seedImportPlan'
import type { SeedRow, SeedSet } from './types'

/** CASE-studio-080~084 (docs/qa/db-studio.md) */

const col = (id: string, name: string, over: Partial<TableDef['columns'][number]> = {}) => ({
  id,
  name,
  type: 'VARCHAR(64)',
  nullable: true,
  defaultValue: null,
  comment: '',
  ...over
})

const pk = (id: string, colIds: string[]): Constraint => ({
  id,
  kind: 'pk',
  name: 'PRIMARY',
  columns: colIds.map((c) => ({ columnId: c }))
})

const fkCon = (id: string, colId: string, refTable: string): Constraint => ({
  id,
  kind: 'fk',
  name: `fk_${colId}`,
  columns: [{ columnId: colId }],
  refTable,
  refColumns: ['id']
})

const table = (name: string, cols: TableDef['columns'], constraints: Constraint[] = []): TableDef => ({
  id: `t:${name}`,
  designId: 'd1',
  name,
  comment: '',
  columns: cols,
  constraints
})

const row = (id: string, alias: string | undefined, values: Record<string, string | null>): SeedRow => ({
  id,
  alias,
  values
})

const set = (tableName: string, rows: SeedRow[], over: Partial<SeedSet> = {}): SeedSet => ({
  designId: 'd1',
  tableName,
  naturalKey: ['code'],
  ignoredColumns: [],
  strength: 'ensure',
  rows,
  ...over
})

const usersTable = table(
  'users',
  [col('c1', 'id', { defaultValue: 'AUTO_INCREMENT' }), col('c2', 'code'), col('c3', 'name')],
  [pk('k1', ['c1'])]
)

describe('CASE-studio-080 실 DB 에만 있는 행 → 새 후보', () => {
  it('새 행을 후보로 만들고 별칭을 제안한다', () => {
    const p = planSeedImport({
      sets: [set('users', [])],
      tables: [usersTable],
      current: { users: [{ id: 7, code: 'admin@acme.com', name: '관리자' }] }
    })
    expect(p.summary).toMatchObject({ added: 1, changed: 0 })
    expect(p.candidates[0]).toMatchObject({
      status: 'new',
      label: 'admin@acme.com',
      suggestedAlias: 'admin-acme-com'
    })
    expect(p.candidates[0].values).toEqual({ code: 'admin@acme.com', name: '관리자' })
  })

  it('DB 가 만드는 PK 는 담지 않는다 — 환경마다 다른 값은 설계 정본에 넣지 않는다', () => {
    const p = planSeedImport({
      sets: [set('users', [])],
      tables: [usersTable],
      current: { users: [{ id: 7, code: 'admin', name: 'x' }] }
    })
    expect(p.candidates[0].values).not.toHaveProperty('id')
  })

  it('무시 컬럼은 가져오지 않는다', () => {
    const p = planSeedImport({
      sets: [set('users', [], { ignoredColumns: ['name'] })],
      tables: [usersTable],
      current: { users: [{ id: 7, code: 'admin', name: 'x' }] }
    })
    expect(p.candidates[0].values).toEqual({ code: 'admin' })
  })
})

describe('CASE-studio-081 값이 다른 행 → 변경 후보', () => {
  it('무엇이 어떻게 다른지 담는다(기준 컬럼은 제외 — 그래서 짝지어진 행이다)', () => {
    const p = planSeedImport({
      sets: [set('users', [row('r1', 'admin', { code: 'admin', name: '옛 이름' })])],
      tables: [usersTable],
      current: { users: [{ id: 7, code: 'admin', name: '새 이름' }] }
    })
    expect(p.summary).toMatchObject({ added: 0, changed: 1 })
    expect(p.candidates[0]).toMatchObject({ status: 'changed', rowId: 'r1' })
    expect(p.candidates[0].changes).toEqual([{ column: 'name', design: '옛 이름', actual: '새 이름' }])
  })

  it('같은 값이면 후보가 아니다', () => {
    const p = planSeedImport({
      sets: [set('users', [row('r1', 'admin', { code: 'admin', name: '같음' })])],
      tables: [usersTable],
      current: { users: [{ id: 7, code: 'admin', name: '같음' }] }
    })
    expect(p.candidates).toEqual([])
  })
})

describe('CASE-studio-082 설계에만 있는 행', () => {
  it('실 DB 에 없는 설계 행을 알린다(채택 대상이 아니라 사실 보고)', () => {
    const p = planSeedImport({
      sets: [set('users', [row('r1', 'admin', { code: 'admin' })])],
      tables: [usersTable],
      current: { users: [] }
    })
    expect(p.summary.onlyInDesign).toBe(1)
    expect(p.candidates[0]).toMatchObject({ status: 'only-in-design', rowId: 'r1' })
  })
})

describe('CASE-studio-083 FK 값을 참조 표기로 되돌린다', () => {
  const profilesTable = table(
    'user_profiles',
    [col('p0', 'id', { defaultValue: 'AUTO_INCREMENT' }), col('p1', 'user_id'), col('p2', 'code')],
    [pk('pk', ['p0']), fkCon('k2', 'p1', 'users')]
  )

  it('대상 시드 행의 별칭으로 되돌린다', () => {
    const p = planSeedImport({
      sets: [set('users', [row('u1', 'admin', { code: 'admin' })]), set('user_profiles', [])],
      tables: [usersTable, profilesTable],
      current: {
        users: [{ id: 412, code: 'admin' }],
        user_profiles: [{ id: 9, code: 'p1', user_id: 412 }]
      }
    })
    const cand = p.candidates.find((c) => c.table === 'user_profiles')!
    expect(cand.values.user_id).toBe('@users#admin')
  })

  it('되돌릴 근거가 없으면 원값을 두고 알린다(침묵하지 않는다)', () => {
    const p = planSeedImport({
      sets: [set('users', [row('u1', undefined, { code: 'admin' })]), set('user_profiles', [])],
      tables: [usersTable, profilesTable],
      current: {
        users: [{ id: 412, code: 'admin' }],
        user_profiles: [{ id: 9, code: 'p1', user_id: 412 }]
      }
    })
    const cand = p.candidates.find((c) => c.table === 'user_profiles')!
    expect(cand.values.user_id).toBe('412')
    expect(p.notes.some((n) => n.includes('되돌리지 못했'))).toBe(true)
  })
})

describe('CASE-studio-084 준비 안 된 세트', () => {
  it('짝짓기 기준이 없으면 가져오지 않고 이유를 남긴다', () => {
    const p = planSeedImport({
      sets: [set('users', [], { naturalKey: [] })],
      tables: [usersTable],
      current: { users: [{ id: 1, code: 'a' }] }
    })
    expect(p.candidates).toEqual([])
    expect(p.notes[0]).toContain('짝짓기 기준')
  })
})
