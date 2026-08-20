import { parseIntrospection } from './graphql'
import { ImportError, type ImportResult } from './importOpenapi'
import type { FieldDef, FieldType, ParamDef, ParamType, RequestDef } from './types'

/**
 * GraphQL 가져오기.
 *
 * 두 갈래를 다 받는다: **SDL**(사람이 쓴 스키마 글)과 **introspection 결과**(서버가 뱉은 JSON).
 * SDL 은 파서를 더하지 않고 `type X { ... }` 블록만 좁게 읽고, 못 읽은 구문은 **보고**한다.
 */

const SCALARS: Record<string, FieldType> = {
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  String: 'string',
  ID: 'string'
}

interface SdlField {
  name: string
  args: { name: string; type: string; required: boolean }[]
  type: string
  required: boolean
  list: boolean
}

const strip = (src: string): string =>
  src.replace(/"""[\s\S]*?"""/g, ' ').replace(/#[^\n]*/g, ' ').replace(/"(?:[^"\\]|\\.)*"/g, '""')

function typeBlocks(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /\btype\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.set(m[1], src.slice(re.lastIndex, i - 1))
  }
  return out
}

/** `field(arg: T!): [U!]!` 한 줄을 읽는다. */
function parseSdlFields(body: string): SdlField[] {
  const out: SdlField[] = []
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:\s*(\[?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(!?)\s*\]?\s*(!?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const [, name, rawArgs, open, type, innerBang, outerBang] = m
    const args = (rawArgs ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        const am = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[?\s*([A-Za-z_][A-Za-z0-9_]*)\s*(!?)/.exec(a)
        return am ? { name: am[1], type: am[2], required: am[3] === '!' } : null
      })
      .filter((x): x is { name: string; type: string; required: boolean } => x !== null)
    out.push({
      name,
      args,
      type,
      list: open === '[',
      required: (open === '[' ? outerBang : innerBang) === '!'
    })
  }
  return out
}

function paramTypeOf(t: string): ParamType {
  const s = SCALARS[t]
  return s === 'number' ? 'number' : s === 'boolean' ? 'boolean' : 'string'
}

export function importGraphql(source: string): ImportResult {
  const trimmed = source.trim()
  const unsupported: string[] = []
  const report = (s: string): void => {
    if (!unsupported.includes(s)) unsupported.push(s)
  }

  // ── introspection 결과(JSON) ──
  if (trimmed.startsWith('{')) {
    let payload: unknown
    try {
      payload = JSON.parse(trimmed)
    } catch (e) {
      throw new ImportError(`JSON 을 읽지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`)
    }
    let schema
    try {
      schema = parseIntrospection(payload)
    } catch (e) {
      throw new ImportError(
        `introspection 결과가 아닙니다 — ${e instanceof Error ? e.message : String(e)} (SDL 이라면 그대로 붙여 넣으세요.)`
      )
    }
    const requests: RequestDef[] = Object.entries(schema.rootFields).map(([root, fields]) => ({
      id: `imp_${root}`,
      name: root,
      folder: '',
      shape: 'unary',
      params: [],
      request: {
        path: '/graphql',
        graphqlQuery: `{ ${root} { ${fields.map((f) => f.name).join(' ') || '__typename'} } }`
      },
      responses: [{ status: '200', fields }],
      docs: ''
    }))
    if (requests.length === 0) report('introspection 결과에서 루트 필드를 찾지 못했습니다.')
    return { name: 'graphql-api', requests, unsupported }
  }

  // ── SDL ──
  const src = strip(source)
  const types = typeBlocks(src)
  if (types.size === 0) {
    throw new ImportError('GraphQL SDL 에서 `type` 블록을 찾지 못했습니다 (introspection JSON 이라면 그대로 붙여 넣으세요).')
  }

  for (const [keyword, label] of [
    ['interface', 'interface'],
    ['union', 'union'],
    ['directive', 'directive'],
    ['extend', 'extend']
  ] as const) {
    if (new RegExp(`\\b${keyword}\\s`).test(src)) report(`\`${label}\` 는 아직 옮기지 못합니다.`)
  }

  const enums = new Set([...src.matchAll(/\benum\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))

  const fieldDefs = (typeName: string, depth = 0): FieldDef[] => {
    if (depth > 4) return []
    const body = types.get(typeName)
    if (!body) return []
    return parseSdlFields(body).map((f) => {
      const scalar = SCALARS[f.type]
      const def: FieldDef = {
        name: f.name,
        type: f.list ? 'array' : (scalar ?? (enums.has(f.type) ? 'string' : 'object')),
        // SDL 의 `!` 가 곧 필수여부다 — 서버가 표준으로 말해 주므로 `모름` 이 없다.
        requiredness: f.required ? 'required' : 'nullable'
      }
      if (!scalar && !enums.has(f.type) && !f.list) {
        const nested = fieldDefs(f.type, depth + 1)
        if (nested.length > 0) def.fields = nested
      }
      return def
    })
  }

  const requests: RequestDef[] = []
  const taken = new Set<string>()

  for (const rootName of ['Query', 'Mutation']) {
    const body = types.get(rootName)
    if (!body) continue
    for (const f of parseSdlFields(body)) {
      let name = f.name
      for (let n = 2; taken.has(name); n++) name = `${name}${n}`
      taken.add(name)

      const params: ParamDef[] = f.args.map((a) => ({
        name: a.name,
        type: paramTypeOf(a.type),
        required: a.required
      }))
      const fields = fieldDefs(f.type)
      const selection = fields.map((x) => x.name).join(' ') || '__typename'
      const argList = f.args.length > 0 ? `(${f.args.map((a) => `${a.name}: {{${a.name}}}`).join(', ')})` : ''
      const op = rootName === 'Mutation' ? 'mutation' : 'query'

      requests.push({
        id: `imp_${name}`,
        name,
        folder: rootName,
        shape: 'unary',
        params,
        request: { path: '/graphql', graphqlQuery: `${op} { ${f.name}${argList} { ${selection} } }` },
        responses: [{ status: '200', fields }],
        docs: ''
      })
    }
  }

  if (requests.length === 0) report('SDL 에 Query·Mutation 타입이 없어 가져올 요청이 없습니다.')
  return { name: 'graphql-api', requests, unsupported }
}
