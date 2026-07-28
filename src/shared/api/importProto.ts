import { ImportError, type ImportResult } from './importOpenapi'
import type { FieldDef, FieldType, InteractionShape, RequestDef } from './types'

/**
 * `.proto` 가져오기 — `docs/spec/api-studio.md` § requests.import AC-2.
 *
 * **스트리밍 종류를 사람이 고르지 않는다** — proto 메서드 정의가 정한다(shape AC-3).
 * 파서를 더하지 않고 좁은 규칙으로 읽되, 모르는 구문은 **버리지 않고 보고**한다.
 */

const SCALARS: Record<string, FieldType> = {
  double: 'number',
  float: 'number',
  int32: 'number',
  int64: 'number',
  uint32: 'number',
  uint64: 'number',
  sint32: 'number',
  sint64: 'number',
  fixed32: 'number',
  fixed64: 'number',
  sfixed32: 'number',
  sfixed64: 'number',
  bool: 'boolean',
  string: 'string',
  bytes: 'string'
}

interface ProtoField {
  name: string
  type: string
  repeated: boolean
}

/** 주석과 문자열 리터럴을 걷어낸다 — 그 안의 중괄호·세미콜론에 속지 않게. */
function clean(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

/** `name { ... }` 블록을 이름→본문으로 모은다(중괄호 짝을 세어 중첩을 건넌다). */
function blocks(src: string, keyword: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const re = new RegExp(`\\b${keyword}\\s+([A-Za-z_][A-Za-z0-9_.]*)\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push({ name: m[1], body: src.slice(re.lastIndex, i - 1) })
  }
  return out
}

function fieldsOf(body: string): ProtoField[] {
  const out: ProtoField[] = []
  // `repeated Foo bar = 1;` — 중첩 블록 안쪽은 blocks() 가 따로 읽으므로 여기선 한 줄짜리만 본다.
  const re = /(?:^|;|\})\s*(repeated\s+|optional\s+|required\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\d+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const label = (m[1] ?? '').trim()
    if (['message', 'enum', 'service', 'oneof', 'rpc', 'option', 'reserved'].includes(m[2])) continue
    out.push({ name: m[3], type: m[2], repeated: label === 'repeated' })
  }
  return out
}

export function importProto(source: string): ImportResult {
  const src = clean(source)
  const unsupported: string[] = []
  const report = (s: string): void => {
    if (!unsupported.includes(s)) unsupported.push(s)
  }

  const services = blocks(src, 'service')
  if (services.length === 0) {
    throw new ImportError('`.proto` 에서 service 를 찾지 못했습니다 — 이 파일에 rpc 정의가 있는지 확인하세요.')
  }

  const messages = new Map(blocks(src, 'message').map((b) => [b.name, fieldsOf(b.body)]))
  const enums = new Set(blocks(src, 'enum').map((b) => b.name))

  for (const key of ['oneof', 'extend']) {
    if (new RegExp(`\\b${key}\\b`).test(src)) report(`\`${key}\` 는 아직 옮기지 못합니다.`)
  }
  if (/\bmap\s*</.test(src)) report('`map<>` 필드는 아직 옮기지 못합니다.')
  for (const m of src.matchAll(/\bimport\s+""/g)) {
    void m
    report('다른 `.proto` 를 import 한 부분은 읽지 못합니다 — 그 파일의 메시지는 빈 모양이 됩니다.')
  }

  const fieldDefs = (typeName: string, depth = 0): FieldDef[] => {
    if (depth > 5) return []
    const fields = messages.get(typeName) ?? messages.get(typeName.split('.').pop() ?? '')
    if (!fields) return []
    return fields.map((f) => {
      const scalar = SCALARS[f.type]
      const type: FieldType = f.repeated ? 'array' : (scalar ?? (enums.has(f.type) ? 'string' : 'object'))
      const def: FieldDef = {
        name: f.name,
        type,
        // proto3 는 필드 존재를 보장하지 않는다(직렬화에 따라 빠질 수 있다) — 없을 수 있다고 본다.
        requiredness: 'nullable'
      }
      if (!scalar && !enums.has(f.type)) {
        const nested = fieldDefs(f.type, depth + 1)
        if (nested.length > 0) def.fields = nested
      }
      return def
    })
  }

  const requests: RequestDef[] = []
  const taken = new Set<string>()

  for (const svc of services) {
    const rpcRe =
      /\brpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(stream\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*\)\s*returns\s*\(\s*(stream\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g
    let m: RegExpExecArray | null
    let found = 0
    while ((m = rpcRe.exec(svc.body))) {
      found++
      const [, method, reqStream, reqType, resStream, resType] = m
      // 모양은 proto 가 정한다 — 사람이 고르지 않는다.
      const shape: InteractionShape = reqStream ? 'duplex' : resStream ? 'server-stream' : 'unary'

      let name = `${svc.name}.${method}`
      for (let n = 2; taken.has(name); n++) name = `${name}${n}`
      taken.add(name)

      const reqFields = fieldDefs(reqType)
      requests.push({
        id: `imp_${name.replace(/\W/g, '_')}`,
        name,
        folder: svc.name,
        shape,
        params: [],
        request: {
          grpcMethod: `/${svc.name}/${method}`,
          // 요청 메시지 필드를 빈 템플릿으로 깔아 둔다 — 값을 지어내지 않는다.
          body: reqFields.length > 0 ? `{\n${reqFields.map((f) => `  "${f.name}": ""`).join(',\n')}\n}` : '{}'
        },
        responses: [{ status: 'OK', fields: fieldDefs(resType) }],
        docs: ''
      })
    }
    if (found === 0) report(`service ${svc.name} 안에서 rpc 를 찾지 못했습니다.`)
  }

  const pkg = /\bpackage\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/.exec(src)?.[1]
  return { name: pkg ?? services[0].name, requests, unsupported }
}
