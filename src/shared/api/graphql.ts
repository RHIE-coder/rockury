import type { FieldDef, FieldType } from './types'
import type { ServerSchema } from './drift'

/**
 * GraphQL introspection — `docs/spec/api-contract.md` § drift.complete.
 *
 * GraphQL 이 완전 판정 대상인 이유는 여기 있다: **서버가 자기 스키마를 표준 질의 하나로
 * 통째로 뱉는다.** 스키마에서 서버를 만드는 방식이라 도로 뱉을 수 있고, 손으로 라우트를
 * 짜는 REST 는 뱉을 게 없다 — 그 차이가 판정 2등급을 가른다.
 *
 * 의존성을 더하지 않으려고 GraphQL 파서를 쓰지 않는다. 대신 우리가 필요한 두 가지만 한다:
 *   ① introspection 결과(JSON) → 루트 이름 → 반환 필드 모양
 *   ② 사용자가 쓴 질의문에서 **루트 필드 이름 하나** 읽기
 * ②를 못 읽으면 **모른다고 두고 판정에서 뺀다** — 지어내지 않는다.
 */

/** 우리가 쓰는 만큼만 묻는다 — 전체 introspection 은 응답이 매우 크다. */
export const INTROSPECTION_QUERY = `query RockuryIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name
      kind
      fields {
        name
        type { ...T }
      }
    }
  }
}
fragment T on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name } } }
}`

interface TypeRef {
  kind: string
  name: string | null
  ofType?: TypeRef | null
}

interface IntrospectedField {
  name: string
  type: TypeRef
}

interface IntrospectedType {
  name: string
  kind: string
  fields?: IntrospectedField[] | null
}

/** GraphQL 스칼라 → 우리 타입. 모르는 스칼라는 문자열로 본다(대개 직렬화가 문자열이다). */
function scalarType(name: string | null): FieldType {
  switch (name) {
    case 'Int':
    case 'Float':
      return 'number'
    case 'Boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

interface Unwrapped {
  type: FieldType
  /** NON_NULL 로 감싸여 있으면 서버가 늘 준다고 **표준으로** 말한 것이다. */
  required: boolean
  /** 객체면 그 타입 이름 — 필드를 더 따라 들어갈 때 쓴다. */
  objectName: string | null
}

function unwrap(ref: TypeRef): Unwrapped {
  let required = false
  let cur: TypeRef | null | undefined = ref
  if (cur?.kind === 'NON_NULL') {
    required = true
    cur = cur.ofType
  }
  if (cur?.kind === 'LIST') {
    // 목록 자체의 모양만 본다 — 원소 타입까지 파고들면 순환 참조로 끝이 없다.
    return { type: 'array', required, objectName: null }
  }
  if (!cur) return { type: 'string', required, objectName: null }
  if (cur.kind === 'OBJECT' || cur.kind === 'INTERFACE' || cur.kind === 'UNION') {
    return { type: 'object', required, objectName: cur.name }
  }
  if (cur.kind === 'ENUM') return { type: 'string', required, objectName: null }
  return { type: scalarType(cur.name), required, objectName: null }
}

/** 순환 참조(User.friends: [User])에서 멈추기 위한 깊이 한도. */
const MAX_DEPTH = 4

function fieldsOf(
  typeName: string | null,
  byName: Map<string, IntrospectedType>,
  depth: number,
  seen: Set<string>
): FieldDef[] {
  if (!typeName || depth > MAX_DEPTH || seen.has(typeName)) return []
  const t = byName.get(typeName)
  if (!t?.fields) return []
  const nextSeen = new Set(seen).add(typeName)

  return t.fields.map((f) => {
    const u = unwrap(f.type)
    const def: FieldDef = {
      name: f.name,
      type: u.type,
      // 서버가 표준으로 말해 준 것이라 `모름` 이 아니다 — 완전 판정이 완전한 이유.
      requiredness: u.required ? 'required' : 'nullable'
    }
    const nested = fieldsOf(u.objectName, byName, depth + 1, nextSeen)
    if (nested.length > 0) def.fields = nested
    return def
  })
}

export class IntrospectionError extends Error {}

/**
 * introspection 응답 → 루트 이름 → 반환 필드 모양.
 * Query·Mutation 의 루트 필드를 한 지도에 담는다(이름이 겹치는 스키마는 드물고, 겹치면 Query 우선).
 */
export function parseIntrospection(payload: unknown): ServerSchema {
  const data = (payload as { data?: { __schema?: unknown } })?.data?.__schema as
    | {
        queryType?: { name: string } | null
        mutationType?: { name: string } | null
        types?: IntrospectedType[]
      }
    | undefined
  if (!data || !Array.isArray(data.types)) {
    throw new IntrospectionError('introspection 응답에서 __schema 를 찾지 못했습니다.')
  }

  const byName = new Map(data.types.map((t) => [t.name, t]))
  const rootFields: Record<string, FieldDef[]> = {}

  for (const rootName of [data.mutationType?.name, data.queryType?.name]) {
    const root = rootName ? byName.get(rootName) : undefined
    for (const f of root?.fields ?? []) {
      const u = unwrap(f.type)
      rootFields[f.name] = fieldsOf(u.objectName, byName, 1, new Set([rootName!]))
    }
  }
  return { rootFields }
}

/**
 * 질의문에서 **루트 필드 이름 하나**를 읽는다. 못 읽으면 `null` —
 * 그러면 그 요청은 판정에서 빠지고, 빠졌다는 사실이 커버리지에 남는다.
 *
 * 파서를 쓰지 않는 대신 규칙을 좁게 잡았다: 괄호 밖의 첫 `{` 뒤에 오는 첫 이름.
 * 별칭(`me: user`)이면 별칭이 아니라 **실제 필드 이름**을 쓴다.
 */
export function rootFieldOf(query: string): string | null {
  // 주석과 문자열 리터럴을 걷어낸다 — 그 안의 중괄호에 속지 않게.
  const src = query.replace(/#[^\n]*/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""')

  let depth = 0
  let start = -1
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '{' && depth === 0) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null

  const rest = src.slice(start)
  const first = /^\s*(?:\.\.\.\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)
  if (!first) return null

  // 별칭이면 콜론 뒤가 진짜 이름이다.
  const after = rest.slice(first[0].length)
  const alias = /^\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(after)
  return alias ? alias[1] : first[1]
}
