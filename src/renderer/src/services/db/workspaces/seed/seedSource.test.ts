import { describe, expect, it } from 'vitest'
import type { TableDef } from '../definition/types'
import {
  defaultSeedSources,
  guessNaturalKey,
  seedSetsToCreate,
  seedSourceOptions,
  seedSourceSets,
  seedSourceTable
} from './seedSource'
import type { SeedSet } from './types'

const col = (id: string, name: string, over: Partial<TableDef['columns'][number]> = {}) => ({
  id,
  name,
  type: 'VARCHAR(64)',
  nullable: false,
  defaultValue: null,
  comment: '',
  ...over
})

const table = (name: string, cols: TableDef['columns'], pk: string[] = [], over: Partial<TableDef> = {}): TableDef => ({
  id: `t:${name}`,
  designId: 'd1',
  name,
  comment: '',
  columns: cols,
  constraints: pk.length
    ? [{ id: `k:${name}.pk`, kind: 'pk', name: 'PRIMARY', columns: pk.map((c) => ({ columnId: c })) }]
    : [],
  ...over
})

const set = (tableName: string, naturalKey: string[]): SeedSet => ({
  designId: 'd1',
  tableName,
  naturalKey,
  ignoredColumns: [],
  strength: 'ensure',
  rows: []
})

const roles = table('roles', [col('c1', 'code'), col('c2', 'name')], ['c1'])
const users = table('users', [col('u1', 'email'), col('u2', 'name')], ['u1'])
const logs = table('logs', [col('l1', 'msg')])
/** 운영 DB 에서 가져온 표의 흔한 모양 — PK 는 DB 가 만들고, 사람이 아는 기준은 UNIQUE 에 있다. */
const settings = table(
  'settings',
  [col('s1', 'id', { defaultValue: '(UUID())' }), col('s2', 'key'), col('s3', 'value')],
  ['s1'],
  {
    constraints: [
      { id: 'k:settings.pk', kind: 'pk', name: 'PRIMARY', columns: [{ columnId: 's1' }] },
      { id: 'k:settings.uk', kind: 'uk', name: 'uq_settings_key', columns: [{ columnId: 's2' }] }
    ]
  }
)
const view = table('v_active', [col('v1', 'id')], ['v1'], { isView: true })

describe('seedSourceOptions — 실 DB 에서 행을 읽어 올 테이블 고르기', () => {
  it('세트가 없어도 목록에 선다 — 그게 이 화면의 목적이다', () => {
    const opts = seedSourceOptions([roles, users], [])
    expect(opts.map((o) => o.tableName)).toEqual(['roles', 'users'])
    expect(opts.every((o) => !o.hasSet && o.ready)).toBe(true)
    expect(opts[0].naturalKey).toEqual(['code'])
  })

  it('이미 세트가 있으면 그 세트의 짝짓기 기준을 쓴다 — 설계 추정으로 덮지 않는다', () => {
    const opts = seedSourceOptions([users], [set('users', ['name'])])
    expect(opts[0]).toMatchObject({ hasSet: true, naturalKey: ['name'], ready: true })
  })

  it('짝짓기 기준을 못 세우는 테이블도 남기되 이유를 단다 — 조용히 빼면 왜 없는지 모른다', () => {
    const opts = seedSourceOptions([logs], [])
    expect(opts[0]).toMatchObject({ tableName: 'logs', ready: false, reason: 'no-key' })
  })

  it('뷰는 뺀다 — 데이터를 담지 않는다', () => {
    expect(seedSourceOptions([view, roles], []).map((o) => o.tableName)).toEqual(['roles'])
  })
})

describe('defaultSeedSources — 처음 켜 둘 것', () => {
  it('예전부터 되먹임 대상이던 것(세트가 있고 준비된 것)만 켠다', () => {
    const opts = seedSourceOptions([roles, users, logs], [set('users', ['email'])])
    expect(defaultSeedSources(opts)).toEqual(['users'])
  })

  it('세트가 하나도 없으면 아무것도 안 켠다 — 무엇을 읽을지는 사람이 정한다', () => {
    expect(defaultSeedSources(seedSourceOptions([roles, users], []))).toEqual([])
  })
})

describe('seedSourceSets — 고른 것으로 되먹임에 쓸 세트', () => {
  it('세트가 없는 테이블은 빈 세트로 만든다 — 실 DB 행이 전부 "설계에 없음" 후보가 된다', () => {
    const sets = seedSourceSets({ tables: [roles, users], sets: [], picked: ['roles'] })
    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({ tableName: 'roles', naturalKey: ['code'], rows: [] })
  })

  it('있는 세트는 그대로 물린다 — 행이 살아 있어야 "값이 다름"을 가린다', () => {
    const existing = set('users', ['email'])
    existing.rows = [{ id: 'row-1', values: { email: 'a@b.c' } }]
    const sets = seedSourceSets({ tables: [users], sets: [existing], picked: ['users'] })
    expect(sets[0]).toBe(existing)
  })

  it('안 고른 것과 설계에 없는 이름은 뺀다', () => {
    expect(seedSourceSets({ tables: [roles], sets: [], picked: ['roles', '없는표'] })).toHaveLength(1)
    expect(seedSourceSets({ tables: [roles], sets: [], picked: [] })).toEqual([])
  })
})

describe('seedSetsToCreate — 담기 전에 새로 만들어야 할 세트', () => {
  it('고른 것 중 아직 세트가 없는 테이블만', () => {
    const out = seedSetsToCreate({
      tables: [roles, users],
      sets: [set('users', ['email'])],
      tableNames: ['roles', 'users']
    })
    expect(out.map((x) => x.tableName)).toEqual(['roles'])
  })

  it('읽을 때 물렸던 것과 같은 짝짓기 기준으로 만든다', () => {
    const out = seedSetsToCreate({ tables: [settings], sets: [], tableNames: ['settings'] })
    expect(out[0].naturalKey).toEqual(['key'])
    expect(out[0].rows).toEqual([])
  })
})

describe('guessNaturalKey — PK 가 DB 것이면 UNIQUE 를 본다', () => {
  it('PK 가 쓸 만하면 PK 를 쓴다', () => {
    expect(guessNaturalKey(roles)).toEqual(['code'])
  })

  it('PK 가 DB 생성이면 UNIQUE 컬럼으로 내려간다 — 운영에서 가져온 표의 흔한 모양이다', () => {
    expect(guessNaturalKey(settings)).toEqual(['key'])
    expect(seedSourceOptions([settings], [])[0]).toMatchObject({ ready: true, naturalKey: ['key'] })
  })

  it('짧은 UNIQUE 를 고른다 — 행 이름이 또렷해진다', () => {
    const t = table('t', [col('a1', 'a'), col('a2', 'b'), col('a3', 'c')], [], {
      constraints: [
        { id: 'k1', kind: 'uk', name: 'uk_ab', columns: [{ columnId: 'a1' }, { columnId: 'a2' }] },
        { id: 'k2', kind: 'uk', name: 'uk_c', columns: [{ columnId: 'a3' }] }
      ]
    })
    expect(guessNaturalKey(t)).toEqual(['c'])
  })

  it('UNIQUE 가 DB 생성 컬럼이면 안 쓴다 — 환경마다 값이 달라진다', () => {
    const t = table('t', [col('a1', 'id', { defaultValue: '(UUID())' })], [], {
      constraints: [{ id: 'k1', kind: 'uk', name: 'uk_id', columns: [{ columnId: 'a1' }] }]
    })
    expect(guessNaturalKey(t)).toEqual([])
  })
})


/**
 * 회귀(2026-08-18 사용자: "이건왜 동시에 클릭되고 중복되어서 있는거야?").
 * 스키마 여럿을 걸친 설계에서 같은 이름이 두 줄로 서고, 시드는 이름으로만 가리키므로
 * 둘이 한 몸처럼 켜졌다(React 키도 겹쳐 콘솔이 울었다).
 */
describe('같은 이름이 여러 스키마에 있을 때', () => {
  const s1 = table('members', [col('m1', 'id'), col('m2', 'email')], ['m1'], { schema: 'service1' })
  const s2 = table('members', [col('n1', 'id'), col('n2', 'email')], ['n1'], { schema: 'service2' })
  const inDefault = table('roles', [col('r1', 'code')], ['r1'], { schema: 'testdb' })

  it('이름당 한 줄만 선다 — 두 줄이면 체크가 함께 켜진다', () => {
    const opts = seedSourceOptions([s1, s2, inDefault], [], 'testdb')
    expect(opts.map((o) => o.tableName)).toEqual(['members', 'roles'])
  })

  it('기본 DB 밖이면 막고 이유를 단다 — 시드는 이름만으로 기본 DB 에 나간다', () => {
    const opts = seedSourceOptions([s1, s2, inDefault], [], 'testdb')
    expect(opts[0]).toMatchObject({ ready: false, reason: 'outside-default-schema', schema: 'service1' })
    expect(opts[1]).toMatchObject({ ready: true, schema: 'testdb' })
  })

  it('기본 DB 안에서 이름이 겹치면 어느 표인지 못 가린다고 막는다', () => {
    const a = table('members', [col('m1', 'code')], ['m1'], { schema: 'testdb' })
    const b = table('members', [col('n1', 'code')], ['n1'], { schema: '' })
    expect(seedSourceOptions([a, b], [], 'testdb')[0]).toMatchObject({
      ready: false,
      reason: 'ambiguous-name'
    })
  })

  it('기본 DB 를 모르면 스키마로 거르지 않는다 — 옛 설계·SQLite 는 그대로 돈다', () => {
    const opts = seedSourceOptions([roles, users], [])
    expect(opts.every((o) => o.ready)).toBe(true)
  })

  it('세트도 이름당 하나만 만든다 — 두 벌이면 서로를 덮는다', () => {
    const sets = seedSourceSets({ tables: [s1, s2], sets: [], picked: ['members'] })
    expect(sets).toHaveLength(1)
    expect(seedSetsToCreate({ tables: [s1, s2], sets: [], tableNames: ['members'] })).toHaveLength(1)
  })

  it('대표는 기본 DB 안의 것이 이긴다', () => {
    const mine = table('members', [col('x1', 'code')], ['x1'], { schema: 'testdb' })
    expect(seedSourceTable([s1, mine], 'members', 'testdb')?.schema).toBe('testdb')
    expect(seedSourceTable([s1, mine], '없는표', 'testdb')).toBeUndefined()
  })
})
