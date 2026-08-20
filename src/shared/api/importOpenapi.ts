import { parseJsonOrYaml } from './yaml'
import type { FieldDef, FieldType, ParamDef, ParamType, RequestDef, ResponseDef } from './types'

/**
 * OpenAPI 3.x 가져오기
 *
 * 없으면 첫 화면이 빈 화면이다 — 기존 API 가 있는 팀이 손으로 다시 칠 리 없다.
 *
 * **해석 못 한 것은 버리지 않고 목록으로 보고한다**(AC-5). 조용히 빠뜨리면 "가져왔다"는 말이
 * 거짓이 되고, 그 빈 자리가 나중에 판정에서 "명세에만 없음"으로 되돌아온다.
 */

export interface ImportResult {
  name: string
  requests: RequestDef[]
  /** 읽었지만 우리 모델로 옮기지 못한 것. 비어야만 "전부 가져옴"이다. */
  unsupported: string[]
}

export class ImportError extends Error {}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** 문서 안(`#/...`) 참조만 따라간다. 바깥 파일 참조는 못 읽으므로 보고한다. */
function resolveRef(doc: Json, node: unknown, report: (s: string) => void, seen = new Set<string>()): unknown {
  if (!isObj(node) || typeof node.$ref !== 'string') return node
  const ref = node.$ref
  if (!ref.startsWith('#/')) {
    report(`바깥 파일 참조는 읽지 못합니다: ${ref}`)
    return null
  }
  if (seen.has(ref)) {
    report(`참조가 스스로를 가리켜 멈췄습니다: ${ref}`)
    return null
  }
  let cur: unknown = doc
  for (const part of ref.slice(2).split('/')) {
    cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
  }
  if (cur === undefined) {
    report(`가리키는 곳이 없습니다: ${ref}`)
    return null
  }
  return resolveRef(doc, cur, report, new Set(seen).add(ref))
}

function fieldType(schema: Json, path: string, report: (s: string) => void): FieldType | null {
  const t = schema.type
  if (t === 'integer' || t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'string') return 'string'
  if (t === 'array') return 'array'
  if (t === 'object') return 'object'
  if (isObj(schema.properties)) return 'object'
  if (schema.items !== undefined) return 'array'
  if (Array.isArray(schema.enum)) return 'string'
  for (const key of ['oneOf', 'anyOf', 'allOf', 'not']) {
    if (schema[key] !== undefined) {
      report(`${path}: ${key} 는 하나의 모양으로 옮기지 못해 건너뜁니다.`)
      return null
    }
  }
  report(`${path}: 타입이 없어 모양을 정하지 못했습니다.`)
  return null
}

function fieldsOfSchema(
  doc: Json,
  rawSchema: unknown,
  path: string,
  report: (s: string) => void,
  depth = 0
): FieldDef[] {
  if (depth > 6) return []
  const schema = resolveRef(doc, rawSchema, report)
  if (!isObj(schema)) return []

  if (schema.type === 'array' || (schema.items !== undefined && schema.type === undefined)) {
    return fieldsOfSchema(doc, schema.items, `${path}[]`, report, depth + 1)
  }
  const props = resolveRef(doc, schema.properties, report)
  if (!isObj(props)) return []

  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const out: FieldDef[] = []
  for (const [name, rawChild] of Object.entries(props)) {
    const child = resolveRef(doc, rawChild, report)
    if (!isObj(child)) continue
    const type = fieldType(child, `${path}.${name}`, report)
    if (!type) continue
    const def: FieldDef = {
      name,
      type,
      // OpenAPI 는 선언이 명시적이라 `모름` 이 나오지 않는다 —
      // required 목록에 없거나 nullable 이면 "없을 수 있다"가 확정된 사실이다.
      requiredness: required.has(name) && child.nullable !== true ? 'required' : 'nullable'
    }
    if (Array.isArray(child.enum)) def.enumValues = (child.enum as unknown[]).map(String)
    const nested = fieldsOfSchema(doc, child, `${path}.${name}`, report, depth + 1)
    if (nested.length > 0) def.fields = nested
    out.push(def)
  }
  return out
}

function paramType(schema: Json | null): ParamType {
  const t = schema?.type
  if (t === 'integer' || t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'array') return 'array'
  if (t === 'object') return 'object'
  if (Array.isArray(schema?.enum)) return 'enum'
  return 'string'
}

function slug(method: string, path: string): string {
  const cleaned = path
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join('')
  return `${method}${cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : 'Root'}`
}

export function importOpenapi(source: string): ImportResult {
  let doc: unknown
  try {
    doc = parseJsonOrYaml(source)
  } catch (e) {
    throw new ImportError(`문서를 읽지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isObj(doc)) throw new ImportError('OpenAPI 문서가 아닙니다(최상위가 매핑이 아닙니다).')
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) {
    throw new ImportError(
      `OpenAPI 3.x 만 읽습니다 — 이 문서는 ${doc.openapi ? `'${String(doc.openapi)}'` : 'openapi 항목이 없습니다'}. (Swagger 2.0 은 아직입니다.)`
    )
  }

  const unsupported: string[] = []
  const report = (s: string): void => {
    if (!unsupported.includes(s)) unsupported.push(s)
  }

  const info = isObj(doc.info) ? doc.info : {}
  const paths = isObj(doc.paths) ? doc.paths : {}
  const requests: RequestDef[] = []
  const takenNames = new Set<string>()

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = resolveRef(doc, rawItem, report)
    if (!isObj(item)) continue

    for (const method of METHODS) {
      const op = item[method]
      if (!isObj(op)) continue

      // 경로 공통 파라미터 + 오퍼레이션 파라미터를 합친다(오퍼레이션이 이긴다).
      const rawParams = [
        ...(Array.isArray(item.parameters) ? item.parameters : []),
        ...(Array.isArray(op.parameters) ? op.parameters : [])
      ]

      const params: ParamDef[] = []
      const query: Record<string, string> = {}
      const headers: Record<string, string> = {}

      for (const rawParam of rawParams) {
        const p = resolveRef(doc, rawParam, report)
        if (!isObj(p) || typeof p.name !== 'string') continue
        const where = String(p.in ?? '')
        if (!['path', 'query', 'header'].includes(where)) {
          report(`${method.toUpperCase()} ${path}: '${where}' 위치의 파라미터(${p.name})는 옮기지 못합니다.`)
          continue
        }
        const schema = (resolveRef(doc, p.schema, report) as Json | null) ?? null
        const def: ParamDef = {
          name: p.name,
          type: paramType(schema),
          required: p.required === true || where === 'path'
        }
        if (typeof p.description === 'string') def.description = p.description
        if (schema && Array.isArray(schema.enum)) def.enumValues = (schema.enum as unknown[]).map(String)
        if (schema?.default !== undefined) def.defaultValue = String(schema.default)
        if (!params.some((x) => x.name === def.name)) params.push(def)

        if (where === 'query') query[p.name] = `{{${p.name}}}`
        if (where === 'header') headers[p.name] = `{{${p.name}}}`
      }

      const responses: ResponseDef[] = []
      const rawResponses = isObj(op.responses) ? op.responses : {}
      for (const [status, rawRes] of Object.entries(rawResponses)) {
        const res = resolveRef(doc, rawRes, report)
        if (!isObj(res)) continue
        const content = isObj(res.content) ? res.content : {}
        const jsonMedia = Object.keys(content).find((k) => k.includes('json'))
        if (!jsonMedia) {
          // 본문이 없는 응답(204 등)은 정상이다. JSON 이 아닌 본문만 보고한다.
          if (Object.keys(content).length > 0) {
            report(`${method.toUpperCase()} ${path} [${status}]: JSON 이 아닌 응답(${Object.keys(content).join(', ')})은 모양을 옮기지 못합니다.`)
          }
          responses.push({ status, fields: [] })
          continue
        }
        const media = content[jsonMedia] as Json
        responses.push({
          status,
          fields: fieldsOfSchema(doc, media.schema, `${method} ${path} [${status}]`, report)
        })
      }

      // 본문은 템플릿 자리만 만들어 둔다 — 예시 값을 지어내지 않는다.
      let body: string | undefined
      const rb = resolveRef(doc, op.requestBody, report)
      if (isObj(rb)) {
        const content = isObj(rb.content) ? rb.content : {}
        const jsonMedia = Object.keys(content).find((k) => k.includes('json'))
        if (jsonMedia) body = '{\n  \n}'
        else if (Object.keys(content).length > 0) {
          report(`${method.toUpperCase()} ${path}: JSON 이 아닌 요청 본문(${Object.keys(content).join(', ')})은 옮기지 못합니다.`)
        }
      }

      let name = typeof op.operationId === 'string' && op.operationId.trim() ? op.operationId.trim() : slug(method, path)
      for (let n = 2; takenNames.has(name); n++) name = `${name}${n}`
      takenNames.add(name)

      const docs = [op.summary, op.description].filter((x) => typeof x === 'string' && x.trim()).join('\n\n')

      requests.push({
        id: `imp_${name}`,
        name,
        folder: typeof (op.tags as string[] | undefined)?.[0] === 'string' ? (op.tags as string[])[0] : '',
        shape: 'unary',
        params,
        request: {
          method: method.toUpperCase(),
          path,
          ...(Object.keys(query).length > 0 ? { query } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(body !== undefined ? { body } : {})
        },
        responses,
        docs
      })
    }
  }

  for (const key of ['webhooks', 'callbacks', 'security']) {
    if (doc[key] !== undefined) report(`문서의 '${key}' 는 아직 옮기지 못합니다.`)
  }
  if (requests.length === 0) report('가져올 수 있는 경로(paths)가 없습니다.')

  return {
    name: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'imported-api',
    requests,
    unsupported
  }
}
