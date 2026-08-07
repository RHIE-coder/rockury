import { describe, expect, it } from 'vitest'
import { INTROSPECTION_QUERY, IntrospectionError, parseIntrospection, rootFieldOf } from './graphql'
import { driftFromSchema } from './drift'
import type { SpecDef } from './types'

/**
 * GraphQL 완전 판정 — `docs/qa/api-contract.md` S1 (CASE-apicontract-001·005).
 * 서버가 표준으로 뱉은 스키마라 필수여부가 `모름` 이 아니다 — 이게 "완전"의 뜻이다.
 */

const T = {
  nonNull: (of: unknown) => ({ kind: 'NON_NULL', name: null, ofType: of }),
  list: (of: unknown) => ({ kind: 'LIST', name: null, ofType: of }),
  scalar: (name: string) => ({ kind: 'SCALAR', name }),
  object: (name: string) => ({ kind: 'OBJECT', name }),
  enum: (name: string) => ({ kind: 'ENUM', name })
}

const payload = {
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      types: [
        {
          name: 'Query',
          kind: 'OBJECT',
          fields: [
            { name: 'user', type: T.object('User') },
            { name: 'users', type: T.list(T.object('User')) }
          ]
        },
        {
          name: 'Mutation',
          kind: 'OBJECT',
          fields: [{ name: 'createUser', type: T.nonNull(T.object('User')) }]
        },
        {
          name: 'User',
          kind: 'OBJECT',
          fields: [
            { name: 'id', type: T.nonNull(T.scalar('ID')) },
            { name: 'age', type: T.scalar('Int') },
            { name: 'active', type: T.nonNull(T.scalar('Boolean')) },
            { name: 'memo', type: T.scalar('String') },
            { name: 'role', type: T.enum('Role') },
            { name: 'friends', type: T.list(T.object('User')) },
            { name: 'profile', type: T.object('Profile') }
          ]
        },
        {
          name: 'Profile',
          kind: 'OBJECT',
          fields: [{ name: 'bio', type: T.scalar('String') }]
        }
      ]
    }
  }
}

describe('introspection 질의', () => {
  it('우리가 쓸 것만 묻는다 (전체 introspection 은 응답이 너무 크다)', () => {
    expect(INTROSPECTION_QUERY).toContain('__schema')
    expect(INTROSPECTION_QUERY).toContain('queryType')
    expect(INTROSPECTION_QUERY).not.toContain('description') // 설명까지 받으면 응답이 몇 배가 된다
  })
})

describe('introspection 결과 파싱', () => {
  const schema = parseIntrospection(payload)

  it('Query·Mutation 의 루트 필드를 모두 담는다', () => {
    expect(Object.keys(schema.rootFields).sort()).toEqual(['createUser', 'user', 'users'])
  })

  it('NON_NULL 은 required, 아니면 nullable 로 정확히 갈린다 — 여기엔 "모름" 이 없다', () => {
    const user = schema.rootFields.user
    expect(user.find((f) => f.name === 'id')).toMatchObject({ type: 'string', requiredness: 'required' })
    expect(user.find((f) => f.name === 'memo')).toMatchObject({ requiredness: 'nullable' })
    expect(user.every((f) => f.requiredness !== 'unknown')).toBe(true)
  })

  it('스칼라 갈래를 우리 타입으로 옮긴다', () => {
    const user = schema.rootFields.user
    expect(user.find((f) => f.name === 'age')?.type).toBe('number')
    expect(user.find((f) => f.name === 'active')?.type).toBe('boolean')
    expect(user.find((f) => f.name === 'role')?.type).toBe('string') // ENUM 은 문자열로 온다
    expect(user.find((f) => f.name === 'friends')?.type).toBe('array')
  })

  it('중첩 객체를 따라 들어간다', () => {
    expect(schema.rootFields.user.find((f) => f.name === 'profile')?.fields?.[0].name).toBe('bio')
  })

  it('순환 참조(User.friends: [User])에서 멈춘다', () => {
    expect(() => parseIntrospection(payload)).not.toThrow()
  })

  it('모양이 아니면 조용히 빈 스키마를 주지 않고 알린다', () => {
    expect(() => parseIntrospection({})).toThrow(IntrospectionError)
    expect(() => parseIntrospection({ data: { __schema: {} } })).toThrow(IntrospectionError)
  })
})

describe('질의문에서 루트 필드 읽기 — 못 읽으면 지어내지 않는다', () => {
  it('가장 단순한 질의', () => {
    expect(rootFieldOf('{ user { id } }')).toBe('user')
  })

  it('이름·변수 선언이 붙은 질의', () => {
    expect(rootFieldOf('query GetUser($id: ID!) { user(id: $id) { id } }')).toBe('user')
    expect(rootFieldOf('mutation { createUser(input: {a: 1}) { id } }')).toBe('createUser')
  })

  it('변수 기본값 안의 중괄호에 속지 않는다', () => {
    expect(rootFieldOf('query F($f: Filter = {a: 1}) { users { id } }')).toBe('users')
  })

  it('별칭이면 별칭이 아니라 실제 필드 이름을 쓴다', () => {
    expect(rootFieldOf('{ me: user { id } }')).toBe('user')
  })

  it('주석·문자열 안의 중괄호에 속지 않는다', () => {
    expect(rootFieldOf('# { fake }\n{ user { id } }')).toBe('user')
    expect(rootFieldOf('query F($s: String = "{ fake }") { user { id } }')).toBe('user')
  })

  it('여러 줄·들여쓰기', () => {
    expect(rootFieldOf('query {\n  users {\n    id\n  }\n}')).toBe('users')
  })

  it('읽을 수 없으면 null 이다 (빈 질의·깨진 질의)', () => {
    expect(rootFieldOf('')).toBeNull()
    expect(rootFieldOf('query GetUser')).toBeNull()
    expect(rootFieldOf('{ }')).toBeNull()
  })
})

// CASE-apicontract-005 — 결과 모델 공유
describe('CASE-apicontract-005 완전 판정도 같은 결과 타입을 낸다', () => {
  const schema = parseIntrospection(payload)
  const spec = (fields: SpecDef['requests'][number]['responses'][number]['fields']): SpecDef => ({
    id: 's',
    name: 'S',
    description: '',
    docs: '',
    kind: 'graphql',
    requests: [
      {
        id: 'r',
        name: 'getUser',
        folder: '',
        shape: 'unary',
        params: [],
        request: { graphqlQuery: '{ user { id } }' },
        responses: [{ status: '200', fields }],
        docs: ''
      }
    ]
  })

  it('커버리지 100% 이고 등급이 complete 다', () => {
    const d = driftFromSchema({
      spec: spec([]),
      schema,
      environmentName: 'DEV',
      rootOf: { getUser: 'user' }
    })
    expect(d.grade).toBe('complete')
    expect(d.coverage).toMatchObject({ total: 1, observed: 1, unobserved: [] })
  })

  it('서버에만 있는 필드를 잡는다', () => {
    const d = driftFromSchema({ spec: spec([]), schema, environmentName: 'DEV', rootOf: { getUser: 'user' } })
    expect(d.findings.some((f) => f.kind === 'server-only' && f.path === 'getUser.user.id')).toBe(true)
  })

  it('명세에만 있는 필드를 잡는다', () => {
    const d = driftFromSchema({
      spec: spec([{ name: 'gone', type: 'string', requiredness: 'required' }]),
      schema,
      environmentName: 'DEV',
      rootOf: { getUser: 'user' }
    })
    expect(d.findings.some((f) => f.kind === 'spec-only' && f.path === 'getUser.user.gone')).toBe(true)
  })

  it('서버 스키마에 없는 루트를 부르면 "지금 깨진다" 로 잡는다', () => {
    const d = driftFromSchema({
      spec: spec([]),
      schema,
      environmentName: 'DEV',
      rootOf: { getUser: 'noSuchRoot' }
    })
    expect(d.findings[0]).toMatchObject({ kind: 'spec-only', path: 'getUser.noSuchRoot' })
  })

  it('루트를 못 읽은 요청은 판정에서 빠지고 그 사실이 커버리지에 남는다', () => {
    const d = driftFromSchema({ spec: spec([]), schema, environmentName: 'DEV', rootOf: { getUser: null } })
    expect(d.coverage).toMatchObject({ total: 1, observed: 0, unobserved: ['getUser'] })
  })
})
