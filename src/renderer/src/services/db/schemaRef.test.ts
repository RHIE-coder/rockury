import { describe, expect, it } from 'vitest'
import type { TableDef } from './workspaces/definition/types'
import {
  displayName,
  groupBySchema,
  hasMultipleSchemas,
  qualifiedName,
  refTarget,
  resolveRef,
  sameTable
} from './schemaRef'

const tbl = (name: string, schema?: string): TableDef => ({
  id: `${schema ?? ''}.${name}`,
  designId: 'd',
  schema,
  name,
  comment: '',
  columns: [],
  constraints: []
})

const fk = (refTable: string, refSchema?: string) => ({ refTable, refSchema })

describe('sameTable', () => {
  it('이름이 같아도 스키마가 다르면 다른 테이블', () => {
    expect(sameTable({ schema: 'public', name: 'users' }, { schema: 'auth', name: 'users' })).toBe(false)
    expect(sameTable({ schema: 'auth', name: 'users' }, { schema: 'auth', name: 'users' })).toBe(true)
  })

  it('스키마가 비어 있으면 같은 스키마로 친다 — 예전 데이터가 그대로 맞아떨어져야 한다', () => {
    expect(sameTable({ name: 'users' }, { name: 'users' })).toBe(true)
    expect(sameTable({ name: 'users' }, { schema: '', name: 'users' })).toBe(true)
    expect(sameTable({ name: 'users' }, { schema: 'public', name: 'users' })).toBe(false)
  })
})

describe('qualifiedName', () => {
  it('스키마가 있으면 붙이고 없으면 이름만 — 단일 스키마 화면에 점이 안 붙는다', () => {
    expect(qualifiedName({ schema: 'auth', name: 'users' })).toBe('auth.users')
    expect(qualifiedName({ name: 'users' })).toBe('users')
    expect(qualifiedName({ schema: '', name: 'users' })).toBe('users')
  })
})

describe('resolveRef — 이 프로젝트에서 제일 잘 틀리던 자리', () => {
  const tables = [tbl('users', 'public'), tbl('users', 'auth'), tbl('posts', 'public')]

  it('같은 이름이 두 스키마에 있으면 refSchema 로 가른다', () => {
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, fk('users', 'auth'))?.schema).toBe('auth')
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, fk('users', 'public'))?.schema).toBe('public')
  })

  it('refSchema 가 없으면 FK 가 걸린 테이블과 같은 스키마에서 찾는다', () => {
    expect(resolveRef(tables, { schema: 'auth', name: 'sessions' }, fk('users'))?.schema).toBe('auth')
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, fk('users'))?.schema).toBe('public')
  })

  it('못 찾으면 undefined — 그것이 곧 "범위 밖"이다', () => {
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, fk('users', 'billing'))).toBeUndefined()
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, fk('tenants'))).toBeUndefined()
  })

  it('refTable 이 없는 제약(PK·CHECK 등)은 아무것도 가리키지 않는다', () => {
    expect(resolveRef(tables, { schema: 'public', name: 'posts' }, {})).toBeUndefined()
    expect(refTarget({ schema: 'public', name: 'posts' }, {})).toBeUndefined()
  })

  it('스키마 없는 예전 목록은 이름만으로 그대로 이어진다', () => {
    const legacy = [tbl('users'), tbl('posts')]
    expect(resolveRef(legacy, { name: 'posts' }, fk('users'))?.name).toBe('users')
  })
})

describe('refTarget — 목록에 없어도 무엇을 가리키는지는 안다', () => {
  it('범위 밖 대상의 스키마·이름을 편다', () => {
    expect(refTarget({ schema: 'public', name: 'posts' }, fk('users', 'auth'))).toEqual({
      schema: 'auth',
      name: 'users'
    })
    expect(refTarget({ schema: 'public', name: 'posts' }, fk('users'))).toEqual({
      schema: 'public',
      name: 'users'
    })
  })
})

describe('화면 표기', () => {
  it('스키마가 하나뿐이면 접두어를 안 붙인다', () => {
    expect(hasMultipleSchemas([tbl('a', 'public'), tbl('b', 'public')])).toBe(false)
    expect(displayName({ schema: 'public', name: 'users' }, false)).toBe('users')
  })

  it('스키마가 섞여 있으면 붙인다', () => {
    expect(hasMultipleSchemas([tbl('a', 'public'), tbl('b', 'auth')])).toBe(true)
    expect(displayName({ schema: 'public', name: 'users' }, true)).toBe('public.users')
  })

  it('스키마 없는 목록은 하나로 친다', () => {
    expect(hasMultipleSchemas([tbl('a'), tbl('b')])).toBe(false)
    expect(hasMultipleSchemas([tbl('a'), tbl('b', 'auth')])).toBe(true)
  })
})

describe('groupBySchema', () => {
  it('스키마 이름순으로 묶고 안의 순서는 그대로 둔다', () => {
    const got = groupBySchema([tbl('z', 'public'), tbl('a', 'auth'), tbl('y', 'public')])
    expect(got.map((g) => g.schema)).toEqual(['auth', 'public'])
    expect(got[1].tables.map((t) => t.name)).toEqual(['z', 'y'])
  })

  it('스키마 없는 것은 맨 앞 묶음', () => {
    expect(groupBySchema([tbl('a', 'auth'), tbl('b')]).map((g) => g.schema)).toEqual(['', 'auth'])
  })
})
