import { describe, expect, it } from 'vitest'
import type { Constraint, TableDef } from '../definition/types'
import {
  defaultAlias,
  formatSeedRef,
  looksLikeSeedRef,
  parseSeedRef,
  refCellKey,
  seedRefCycles,
  unescapeSeedValue,
  validateAliases,
  validateSeedRefs
} from './seedRef'
import type { SeedRow, SeedSet } from './types'

/** CASE-studio-060~065 (docs/qa/db-studio.md) */

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

const col = (id: string, name: string) => ({
  id,
  name,
  type: 'VARCHAR(64)',
  nullable: false,
  defaultValue: null,
  comment: ''
})

const fk = (id: string, colId: string, refTable: string): Constraint => ({
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

describe('CASE-studio-060 참조 표기 읽기·쓰기', () => {
  it('`@테이블#별칭` 을 읽는다', () => {
    expect(parseSeedRef('@users#admin')).toEqual({ table: 'users', alias: 'admin' })
    expect(parseSeedRef('  @users#admin  ')).toEqual({ table: 'users', alias: 'admin' })
  })

  it('만들기와 읽기가 짝이 맞는다 — 되먹임에서 도구가 같은 규칙으로 되돌린다', () => {
    expect(parseSeedRef(formatSeedRef('users', 'admin-acme'))).toEqual({ table: 'users', alias: 'admin-acme' })
  })

  it('`@@` 로 시작하면 리터럴 — 참조가 아니다', () => {
    expect(parseSeedRef('@@users#admin')).toBeNull()
    expect(unescapeSeedValue('@@handle')).toBe('@handle')
    expect(unescapeSeedValue('plain')).toBe('plain')
  })

  it('규칙에 안 맞는 값은 참조가 아니지만 "참조처럼 보인다"로 잡는다(오타 검출)', () => {
    expect(parseSeedRef('@users.admin@acme.com')).toBeNull()
    expect(looksLikeSeedRef('@users.admin@acme.com')).toBe(true)
    expect(looksLikeSeedRef('@@literal')).toBe(false)
    expect(looksLikeSeedRef('admin')).toBe(false)
    expect(looksLikeSeedRef(null)).toBe(false)
  })

  it('별칭에 허용되지 않는 글자가 있으면 참조로 읽지 않는다', () => {
    expect(parseSeedRef('@users#admin@acme')).toBeNull()
    expect(parseSeedRef('@users#')).toBeNull()
  })

  it('셀 키는 세트·행·컬럼을 가른다', () => {
    expect(refCellKey('users', 'r1', 'org_id')).not.toBe(refCellKey('users', 'r1', 'org'))
    expect(refCellKey('users', 'r1', 'a')).not.toBe(refCellKey('users', 'r1a', ''))
  })
})

describe('CASE-studio-061 기본 별칭 만들기', () => {
  it('짝짓기 기준 값에서 슬러그를 만든다', () => {
    expect(defaultAlias(['admin@acme.com'])).toBe('admin-acme-com')
    expect(defaultAlias(['acme', 'manager'])).toBe('acme-manager')
  })

  it('연속 구분자·앞뒤 구분자를 정리한다', () => {
    expect(defaultAlias(['  Admin  ROLE!! '])).toBe('admin-role')
  })

  it('빈 값·NULL 은 건너뛰고, 쓸 글자가 없으면 빈 문자열', () => {
    expect(defaultAlias([null, 'code', ''])).toBe('code')
    expect(defaultAlias(['!!!'])).toBe('')
    expect(defaultAlias([])).toBe('')
  })
})

describe('CASE-studio-062 별칭 검증', () => {
  it('비어 있는 별칭은 오류가 아니다 — 참조 대상이 아닌 행이 대부분이다', () => {
    expect(validateAliases([row('r1', undefined, {}), row('r2', '', {})])).toEqual({})
  })

  it('겹치는 별칭은 양쪽 다 지목한다', () => {
    const issues = validateAliases([row('r1', 'admin', {}), row('r2', 'admin', {}), row('r3', 'viewer', {})])
    expect(issues.r1?.kind).toBe('duplicate-alias')
    expect(issues.r2?.kind).toBe('duplicate-alias')
    expect(issues.r3).toBeUndefined()
  })

  it('형식이 틀린 별칭을 지목한다', () => {
    const issues = validateAliases([row('r1', 'admin@acme', {}), row('r2', 'ok-1_2', {})])
    expect(issues.r1?.kind).toBe('invalid-alias')
    expect(issues.r2).toBeUndefined()
  })
})

describe('CASE-studio-063 참조 검증', () => {
  const usersTable = table('users', [col('c1', 'code')])
  const profilesTable = table(
    'user_profiles',
    [col('p1', 'user_id'), col('p2', 'bio')],
    [fk('k1', 'p1', 'users')]
  )
  const users = set('users', [row('u1', 'admin', { code: 'admin' })])

  it('정상 참조는 문제가 없다', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { user_id: '@users#admin' })])
    expect(validateSeedRefs([users, profiles], [usersTable, profilesTable])).toEqual({})
  })

  it('시드 세트가 없는 테이블을 가리키면 잡는다', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { user_id: '@orgs#acme' })])
    const issues = validateSeedRefs([users, profiles], [usersTable, profilesTable])
    expect(issues[refCellKey('user_profiles', 'p1', 'user_id')]?.kind).toBe('unknown-table')
  })

  it('없는 별칭을 가리키면 잡는다(깨진 참조)', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { user_id: '@users#ghost' })])
    const issues = validateSeedRefs([users, profiles], [usersTable, profilesTable])
    expect(issues[refCellKey('user_profiles', 'p1', 'user_id')]?.kind).toBe('unknown-alias')
  })

  it('FK 아닌 컬럼에 쓰면 잡는다 — 참조는 관계를 따라가는 표기', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { bio: '@users#admin' })])
    const issues = validateSeedRefs([users, profiles], [usersTable, profilesTable])
    expect(issues[refCellKey('user_profiles', 'p1', 'bio')]?.kind).toBe('not-fk-column')
  })

  it('FK 가 가리키는 테이블과 다른 곳을 가리키면 잡는다 — 남의 테이블 id 를 꽂는 사고', () => {
    const orgs = set('orgs', [row('o1', 'acme', { code: 'acme' })])
    const orgsTable = table('orgs', [col('o1', 'code')])
    const profiles = set('user_profiles', [row('p1', undefined, { user_id: '@orgs#acme' })])
    const issues = validateSeedRefs([users, orgs, profiles], [usersTable, orgsTable, profilesTable])
    expect(issues[refCellKey('user_profiles', 'p1', 'user_id')]?.kind).toBe('fk-table-mismatch')
  })

  it('참조처럼 보이는 오타를 잡는다', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { user_id: '@users.admin' })])
    const issues = validateSeedRefs([users, profiles], [usersTable, profilesTable])
    expect(issues[refCellKey('user_profiles', 'p1', 'user_id')]?.kind).toBe('malformed')
  })

  it('리터럴 탈출(@@)은 참조로 보지 않는다', () => {
    const profiles = set('user_profiles', [row('p1', undefined, { bio: '@@mention' })])
    expect(validateSeedRefs([users, profiles], [usersTable, profilesTable])).toEqual({})
  })
})

describe('CASE-studio-064 순환 참조', () => {
  it('순환이 없으면 빈 목록', () => {
    const a = set('a', [row('r1', 'one', { b_id: '@b#two' })])
    const b = set('b', [row('r2', 'two', {})])
    expect(seedRefCycles([a, b])).toEqual([])
  })

  it('서로 가리키는 두 행을 순환으로 잡는다', () => {
    const a = set('a', [row('r1', 'one', { b_id: '@b#two' })])
    const b = set('b', [row('r2', 'two', { a_id: '@a#one' })])
    const cycles = seedRefCycles([a, b])
    expect(cycles).toHaveLength(1)
    expect(cycles[0][0]).toBe(cycles[0][cycles[0].length - 1]) // 시작으로 돌아온다
    expect(cycles[0]).toContain('a#one')
    expect(cycles[0]).toContain('b#two')
  })

  it('자기 자신을 가리키는 행도 순환이다', () => {
    const a = set('a', [row('r1', 'one', { b_id: '@a#one' })])
    expect(seedRefCycles([a])).toHaveLength(1)
  })

  it('같은 순환을 진입 지점만 달리해 두 번 보고하지 않는다', () => {
    const a = set('a', [row('r1', 'one', { b_id: '@b#two' }), row('r3', 'three', { b_id: '@b#two' })])
    const b = set('b', [row('r2', 'two', { a_id: '@a#one' })])
    expect(seedRefCycles([a, b])).toHaveLength(1)
  })

  it('사용하지 않은 테이블 이름은 그래프에 없다(끊긴 참조는 순환을 만들지 않는다)', () => {
    const a = set('a', [row('r1', 'one', { b_id: '@b#ghost' })])
    expect(seedRefCycles([a])).toEqual([])
  })
})
