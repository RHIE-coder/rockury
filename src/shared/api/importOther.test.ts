import { describe, expect, it } from 'vitest'
import { importProto } from './importProto'
import { importGraphql } from './importGraphql'
import { ImportError } from './importOpenapi'

/** proto·GraphQL 가져오기 — `docs/qa/api-studio.md` CASE-apistudio-021·022·023. */

const PROTO = `
syntax = "proto3";
package billing.v1;

// 사용자 서비스
service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc WatchUsers (WatchRequest) returns (stream User);
  rpc Chat (stream ChatMessage) returns (stream ChatMessage);
}

message GetUserRequest {
  string id = 1;
}

message User {
  string id = 1;
  int32 age = 2;
  bool active = 3;
  repeated string tags = 4;
  Profile profile = 5;
  Role role = 6;
}

message Profile {
  string bio = 1;
}

enum Role {
  ADMIN = 0;
  MEMBER = 1;
}

message WatchRequest { string filter = 1; }
message ChatMessage { string text = 1; }
`

// CASE-apistudio-021
describe('CASE-apistudio-021 proto → 요청', () => {
  const r = importProto(PROTO)

  it('package 를 명세 이름으로 쓴다', () => {
    expect(r.name).toBe('billing.v1')
  })

  it('service.rpc 마다 요청을 만든다', () => {
    expect(r.requests.map((x) => x.name)).toEqual([
      'UserService.GetUser',
      'UserService.WatchUsers',
      'UserService.Chat'
    ])
  })

  it('**스트리밍 종류가 정의에서 자동으로 정해진다** — 사람이 고르지 않는다', () => {
    const shapes = Object.fromEntries(r.requests.map((x) => [x.name, x.shape]))
    expect(shapes['UserService.GetUser']).toBe('unary')
    expect(shapes['UserService.WatchUsers']).toBe('server-stream')
    expect(shapes['UserService.Chat']).toBe('duplex')
  })

  it('gRPC 메서드 경로를 만든다', () => {
    expect(r.requests[0].request.grpcMethod).toBe('/UserService/GetUser')
  })

  it('응답 메시지 필드를 타입까지 옮긴다', () => {
    const fields = r.requests[0].responses[0].fields
    expect(Object.fromEntries(fields.map((f) => [f.name, f.type]))).toEqual({
      id: 'string',
      age: 'number',
      active: 'boolean',
      tags: 'array',
      profile: 'object',
      role: 'string'
    })
  })

  it('중첩 메시지를 따라 들어간다', () => {
    expect(r.requests[0].responses[0].fields.find((f) => f.name === 'profile')?.fields?.[0].name).toBe('bio')
  })

  it('proto3 는 필드 존재를 보장하지 않으므로 nullable 로 둔다', () => {
    expect(r.requests[0].responses[0].fields.every((f) => f.requiredness === 'nullable')).toBe(true)
  })

  it('요청 메시지 필드를 빈 본문 템플릿으로 깔아 둔다 — 값을 지어내지 않는다', () => {
    expect(r.requests[0].request.body).toBe('{\n  "id": ""\n}')
  })

  it('전부 옮겼으면 보고 목록이 비어 있다', () => {
    expect(r.unsupported).toEqual([])
  })

  it('주석 안의 rpc 에 속지 않는다', () => {
    const r2 = importProto('service S {\n  // rpc Fake (A) returns (B);\n  rpc Real (A) returns (B);\n}')
    expect(r2.requests.map((x) => x.name)).toEqual(['S.Real'])
  })

  it('service 가 없으면 분명히 거부한다', () => {
    expect(() => importProto('message A { string b = 1; }')).toThrow(ImportError)
  })

  it('못 옮기는 구문을 보고한다', () => {
    const r2 = importProto(`service S { rpc M (A) returns (B); }
message A { oneof pick { string a = 1; } map<string, string> m = 2; }`)
    expect(r2.unsupported.some((u) => u.includes('oneof'))).toBe(true)
    expect(r2.unsupported.some((u) => u.includes('map<>'))).toBe(true)
  })
})

// CASE-apistudio-022
const SDL = `
"""사용자"""
type User {
  id: ID!
  age: Int
  tags: [String!]!
  profile: Profile
  role: Role
}

type Profile { bio: String }

enum Role { ADMIN MEMBER }

type Query {
  user(id: ID!, expand: Boolean): User
  users: [User!]!
}

type Mutation {
  createUser(name: String!): User!
}
`

describe('CASE-apistudio-022 GraphQL SDL → 요청', () => {
  const r = importGraphql(SDL)

  it('Query·Mutation 루트 필드마다 요청을 만든다', () => {
    expect(r.requests.map((x) => x.name)).toEqual(['user', 'users', 'createUser'])
  })

  it('인자를 호출 파라미터로 옮기고 필수여부를 지킨다', () => {
    const user = r.requests.find((x) => x.name === 'user')!
    expect(user.params).toEqual([
      { name: 'id', type: 'string', required: true },
      { name: 'expand', type: 'boolean', required: false }
    ])
  })

  it('질의문을 만들고 인자를 템플릿 자리로 넣는다', () => {
    expect(r.requests.find((x) => x.name === 'user')!.request.graphqlQuery).toContain(
      'user(id: {{id}}, expand: {{expand}})'
    )
    expect(r.requests.find((x) => x.name === 'createUser')!.request.graphqlQuery).toMatch(/^mutation /)
  })

  it('`!` 가 곧 필수여부다 — 여기엔 "모름" 이 없다', () => {
    const fields = r.requests.find((x) => x.name === 'user')!.responses[0].fields
    expect(fields.find((f) => f.name === 'id')?.requiredness).toBe('required')
    expect(fields.find((f) => f.name === 'age')?.requiredness).toBe('nullable')
    expect(fields.every((f) => f.requiredness !== 'unknown')).toBe(true)
  })

  it('목록·열거형·중첩 타입을 옮긴다', () => {
    const fields = r.requests.find((x) => x.name === 'user')!.responses[0].fields
    expect(fields.find((f) => f.name === 'tags')?.type).toBe('array')
    expect(fields.find((f) => f.name === 'role')?.type).toBe('string')
    expect(fields.find((f) => f.name === 'profile')?.fields?.[0].name).toBe('bio')
  })

  it('폴더로 Query·Mutation 을 가른다', () => {
    expect(r.requests.find((x) => x.name === 'createUser')!.folder).toBe('Mutation')
  })

  it('못 옮기는 구문을 보고한다', () => {
    const r2 = importGraphql('interface Node { id: ID! }\nunion U = A | B\ntype Query { a: String }')
    expect(r2.unsupported.some((u) => u.includes('interface'))).toBe(true)
    expect(r2.unsupported.some((u) => u.includes('union'))).toBe(true)
  })

  it('Query·Mutation 이 없으면 조용히 성공하지 않는다', () => {
    expect(importGraphql('type User { id: ID! }').unsupported.some((u) => u.includes('Query'))).toBe(true)
  })

  it('type 블록이 없으면 분명히 거부한다', () => {
    expect(() => importGraphql('scalar DateTime')).toThrow(ImportError)
  })
})

describe('CASE-apistudio-022 introspection JSON → 요청', () => {
  const payload = JSON.stringify({
    data: {
      __schema: {
        queryType: { name: 'Query' },
        mutationType: null,
        types: [
          { name: 'Query', kind: 'OBJECT', fields: [{ name: 'user', type: { kind: 'OBJECT', name: 'User' } }] },
          {
            name: 'User',
            kind: 'OBJECT',
            fields: [
              { name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID' } } }
            ]
          }
        ]
      }
    }
  })

  it('루트 필드마다 요청을 만들고 질의문을 채운다', () => {
    const r = importGraphql(payload)
    expect(r.requests.map((x) => x.name)).toEqual(['user'])
    expect(r.requests[0].request.graphqlQuery).toBe('{ user { id } }')
    expect(r.requests[0].responses[0].fields[0].requiredness).toBe('required')
  })

  it('introspection 이 아닌 JSON 은 분명히 거부하고 SDL 을 안내한다', () => {
    expect(() => importGraphql('{"a":1}')).toThrow(/SDL/)
  })
})
