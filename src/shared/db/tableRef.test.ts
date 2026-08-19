import { describe, it, expect } from 'vitest'
import { sameTable, refTarget, referencingFks, isSelfRef, type FkLike, type TableRef } from './tableRef'

interface T extends TableRef {
  name: string
  schema?: string
  constraints: FkLike[]
}
const fk = (refTable: string, refSchema?: string, name = `fk_${refTable}`): FkLike & { name: string } => ({
  kind: 'fk',
  refTable,
  refSchema,
  name
})
const kaysOf = (t: T): FkLike[] => t.constraints

describe('sameTable', () => {
  it('이름과 스키마가 둘 다 같아야 같다', () => {
    expect(sameTable({ schema: 'public', name: 'users' }, { schema: 'public', name: 'users' })).toBe(true)
    expect(sameTable({ schema: 'public', name: 'users' }, { schema: 'auth', name: 'users' })).toBe(false)
  })
  it('스키마가 비면 빈 것끼리 같다 — 단일 스키마·옛 데이터가 그대로 맞는다', () => {
    expect(sameTable({ name: 'users' }, { name: 'users' })).toBe(true)
    expect(sameTable({ name: 'users' }, { schema: '', name: 'users' })).toBe(true)
    expect(sameTable({ name: 'users' }, { schema: 'public', name: 'users' })).toBe(false)
  })
})

describe('refTarget', () => {
  it('refSchema 가 비면 FK 가 걸린 테이블과 같은 스키마', () => {
    expect(refTarget({ schema: 'auth', name: 'sessions' }, { refTable: 'users' })).toEqual({
      schema: 'auth',
      name: 'users'
    })
  })
  it('refSchema 가 있으면 그것을 쓴다', () => {
    expect(refTarget({ schema: 'auth', name: 'sessions' }, { refTable: 'users', refSchema: 'public' })).toEqual({
      schema: 'public',
      name: 'users'
    })
  })
  it('FK 가 아니면(대상 없음) undefined', () => {
    expect(refTarget({ name: 'sessions' }, {})).toBeUndefined()
  })
})

describe('referencingFks', () => {
  const tables: T[] = [
    { schema: 'public', name: 'users', constraints: [] },
    { schema: 'public', name: 'orders', constraints: [fk('users')] },
    { schema: 'public', name: 'carts', constraints: [{ kind: 'pk' }, fk('users')] },
    // 다른 스키마의 동명 테이블을 가리킨다 — public.users 를 가리키는 것이 아니다.
    { schema: 'auth', name: 'sessions', constraints: [fk('users')] },
    // 스키마를 명시해 건너온 참조.
    { schema: 'auth', name: 'tokens', constraints: [fk('users', 'public')] }
  ]

  it('나를 가리키는 FK 만 모은다', () => {
    const got = referencingFks(tables, kaysOf, { schema: 'public', name: 'users' })
    expect(got.map((r) => r.table.name)).toEqual(['orders', 'carts', 'tokens'])
  })

  it('스키마가 다르면 이름이 같아도 안 센다 — 이 규칙이 없으면 조용히 엉뚱한 곳에 붙는다', () => {
    const got = referencingFks(tables, kaysOf, { schema: 'auth', name: 'users' })
    expect(got.map((r) => r.table.name)).toEqual(['sessions'])
  })

  it('FK 가 아닌 제약은 안 센다', () => {
    const got = referencingFks(tables, kaysOf, { schema: 'public', name: 'users' })
    expect(got.every((r) => r.constraint.kind === 'fk')).toBe(true)
  })

  it('자기참조도 포함한다 — 거르는 것은 부르는 쪽 몫', () => {
    const self: T[] = [{ name: 'nodes', constraints: [fk('nodes')] }]
    expect(referencingFks(self, kaysOf, { name: 'nodes' })).toHaveLength(1)
  })

  it('가리키는 것이 없으면 빈 배열', () => {
    expect(referencingFks(tables, kaysOf, { schema: 'public', name: 'orders' })).toEqual([])
  })
})

describe('isSelfRef', () => {
  it('제가 걸린 테이블을 가리키면 자기참조', () => {
    expect(isSelfRef({ schema: 'public', name: 'comments' }, fk('comments'))).toBe(true)
  })

  it('스키마를 명시해도 같은 테이블이면 자기참조', () => {
    expect(isSelfRef({ schema: 'public', name: 'comments' }, fk('comments', 'public'))).toBe(true)
  })

  it('이름만 같고 스키마가 다르면 자기참조가 아니다 — 이름만 견주면 여기서 틀린다', () => {
    expect(isSelfRef({ schema: 'public', name: 'comments' }, fk('comments', 'auth'))).toBe(false)
  })

  it('남을 가리키면 아니다', () => {
    expect(isSelfRef({ name: 'comments' }, fk('posts'))).toBe(false)
  })

  it('FK 가 아니면 아니다 — 같은 이름을 들고 있어도', () => {
    expect(isSelfRef({ name: 'comments' }, { kind: 'idx', refTable: 'comments' })).toBe(false)
  })

  it('대상이 비면 아니다(아직 안 고른 FK)', () => {
    expect(isSelfRef({ name: 'comments' }, { kind: 'fk' })).toBe(false)
  })
})
