import type { FieldDef, InterfaceKind, SpecDef } from './types'

/**
 * 내보내기 — `docs/spec/api-studio.md` § requests.export.
 *
 * **불변식 ⑥: 환경 값이 실리지 않는다.** 구조적으로 그렇다 — `SpecDef` 는 값을 들지 않고
 * `{{이름}}` 참조만 든다. 그래서 내보낸 파일을 git 에 올려도 키가 박히지 않는다.
 * 그 사실이 우연이 아니라 보장이 되도록 테스트로 못박는다.
 */

export type ExportFormat = 'openapi' | 'proto' | 'graphql'

export interface ExportResult {
  format: ExportFormat
  filename: string
  content: string
  /** 이 형식으로 옮기지 못한 것. 비어야만 "전부 내보냄"이다. */
  unsupported: string[]
}

export function formatsFor(kind: InterfaceKind): ExportFormat[] {
  if (kind === 'grpc') return ['proto']
  if (kind === 'graphql') return ['graphql']
  return ['openapi']
}

const OPENAPI_TYPE: Record<FieldDef['type'], string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  null: 'string'
}

function toSchema(fields: FieldDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const f of fields) {
    const node: Record<string, unknown> = { type: OPENAPI_TYPE[f.type] }
    if (f.enumValues?.length) node.enum = f.enumValues
    if (f.type === 'object' && f.fields?.length) Object.assign(node, toSchema(f.fields))
    if (f.type === 'array' && f.fields?.length) node.items = toSchema(f.fields)
    // `모름` 은 required 로도 nullable 로도 적지 않는다 — 모르는 것을 문서에 확정해 쓰면 안 된다.
    if (f.requiredness === 'required') required.push(f.name)
    if (f.requiredness === 'nullable') node.nullable = true
    properties[f.name] = node
  }
  return required.length > 0 ? { type: 'object', required, properties } : { type: 'object', properties }
}

function exportOpenapi(spec: SpecDef): ExportResult {
  const unsupported: string[] = []
  const paths: Record<string, Record<string, unknown>> = {}

  for (const r of spec.requests) {
    if (r.shape !== 'unary') {
      unsupported.push(`${r.name}: '${r.shape}' 모양은 OpenAPI 로 옮기지 못해 뺐습니다.`)
      continue
    }
    const path = r.request.path ?? '/'
    const method = (r.request.method ?? 'GET').toLowerCase()
    const where = (name: string): 'path' | 'query' | 'header' => {
      if ((r.request.path ?? '').includes(`{${name}}`) || (r.request.path ?? '').includes(`{{${name}}}`))
        return 'path'
      if (Object.values(r.request.headers ?? {}).some((v) => v.includes(`{{${name}}}`))) return 'header'
      return 'query'
    }

    const parameters: Record<string, unknown>[] = r.params.map((p) => ({
      name: p.name,
      in: where(p.name),
      required: p.required,
      ...(p.description ? { description: p.description } : {}),
      schema: {
        type: p.type === 'enum' ? 'string' : p.type,
        ...(p.enumValues?.length ? { enum: p.enumValues } : {}),
        ...(p.defaultValue !== undefined ? { default: p.defaultValue } : {})
      }
    }))

    // 헤더는 **이름만** 내보낸다. OpenAPI 에는 헤더 값을 담을 자리가 없고, 담아서도 안 된다 —
    // `Authorization: Bearer {{apiKey}}` 의 값 쪽은 환경이 채우는 것이라 파일에 나갈 것이 아니다.
    // 그렇다고 통째로 빼면 "이 엔드포인트가 이 헤더를 받는다"는 계약이 조용히 사라진다.
    for (const headerName of Object.keys(r.request.headers ?? {})) {
      if (parameters.some((p) => p.name === headerName)) continue
      parameters.push({ name: headerName, in: 'header', required: false, schema: { type: 'string' } })
    }

    const op: Record<string, unknown> = {
      operationId: r.name,
      ...(r.folder ? { tags: [r.folder] } : {}),
      ...(r.docs ? { summary: r.docs.split('\n')[0], description: r.docs } : {}),
      parameters,
      responses: Object.fromEntries(
        r.responses.map((res) => [
          res.status,
          {
            description: '',
            ...(res.fields.length > 0
              ? { content: { 'application/json': { schema: toSchema(res.fields) } } }
              : {})
          }
        ])
      )
    }
    if (r.responses.length === 0) {
      op.responses = { default: { description: '선언 없음' } }
      unsupported.push(`${r.name}: 응답 선언이 없어 'default' 로 내보냈습니다.`)
    }
    paths[path] = { ...(paths[path] ?? {}), [method]: op }
  }

  return {
    format: 'openapi',
    filename: `${spec.id}.openapi.json`,
    content: JSON.stringify(
      { openapi: '3.0.3', info: { title: spec.name, description: spec.description, version: '1.0.0' }, paths },
      null,
      2
    ),
    unsupported
  }
}

const PROTO_TYPE: Record<FieldDef['type'], string> = {
  string: 'string',
  number: 'double',
  boolean: 'bool',
  object: 'string',
  array: 'string',
  null: 'string'
}

function messageFor(name: string, fields: FieldDef[]): string {
  const body = fields.map((f, i) => `  ${f.type === 'array' ? 'repeated ' : ''}${PROTO_TYPE[f.type]} ${f.name} = ${i + 1};`)
  return `message ${name} {\n${body.join('\n') || '  // 필드 없음'}\n}`
}

function exportProto(spec: SpecDef): ExportResult {
  const unsupported: string[] = []
  const messages: string[] = []
  const rpcs: string[] = []

  for (const r of spec.requests) {
    const base = r.name.replace(/\W/g, '_')
    const reqName = `${base}Request`
    const resName = `${base}Response`
    messages.push(messageFor(reqName, []))
    messages.push(messageFor(resName, r.responses[0]?.fields ?? []))
    const reqStream = r.shape === 'duplex' ? 'stream ' : ''
    const resStream = r.shape === 'duplex' || r.shape === 'server-stream' ? 'stream ' : ''
    rpcs.push(`  rpc ${base} (${reqStream}${reqName}) returns (${resStream}${resName});`)
    if (r.responses.some((x) => x.fields.some((f) => f.type === 'object' || f.type === 'array'))) {
      unsupported.push(`${r.name}: 중첩·목록 필드는 string 으로 눌러 내보냈습니다(메시지 분해는 아직입니다).`)
    }
  }

  const service = `service ${spec.name.replace(/\W/g, '')} {\n${rpcs.join('\n') || '  // rpc 없음'}\n}`
  return {
    format: 'proto',
    filename: `${spec.id}.proto`,
    content: [`syntax = "proto3";`, `package ${spec.id.replace(/\W/g, '_')};`, '', service, '', ...messages].join('\n') + '\n',
    unsupported
  }
}

const GQL_TYPE: Record<FieldDef['type'], string> = {
  string: 'String',
  number: 'Float',
  boolean: 'Boolean',
  object: 'String',
  array: 'String',
  null: 'String'
}

function exportGraphql(spec: SpecDef): ExportResult {
  const unsupported: string[] = []
  const types: string[] = []
  const queries: string[] = []

  for (const r of spec.requests) {
    const typeName = `${r.name.replace(/\W/g, '_')}Result`
    const fields = r.responses[0]?.fields ?? []
    types.push(
      `type ${typeName} {\n${
        fields.map((f) => `  ${f.name}: ${f.type === 'array' ? `[${GQL_TYPE[f.type]}]` : GQL_TYPE[f.type]}${f.requiredness === 'required' ? '!' : ''}`).join('\n') ||
        '  _empty: String'
      }\n}`
    )
    const args =
      r.params.length > 0
        ? `(${r.params.map((p) => `${p.name}: ${p.type === 'number' ? 'Float' : p.type === 'boolean' ? 'Boolean' : 'String'}${p.required ? '!' : ''}`).join(', ')})`
        : ''
    queries.push(`  ${r.name.replace(/\W/g, '_')}${args}: ${typeName}`)
    if (fields.some((f) => f.type === 'object')) {
      unsupported.push(`${r.name}: 중첩 객체는 String 으로 눌러 내보냈습니다(타입 분해는 아직입니다).`)
    }
  }

  return {
    format: 'graphql',
    filename: `${spec.id}.graphql`,
    content: [`type Query {\n${queries.join('\n') || '  _empty: String'}\n}`, '', ...types].join('\n') + '\n',
    unsupported
  }
}

export function exportSpec(spec: SpecDef, format: ExportFormat): ExportResult {
  if (!formatsFor(spec.kind).includes(format)) {
    throw new Error(
      `${spec.kind} 명세는 ${format} 로 내보낼 수 없습니다 — 가능한 형식: ${formatsFor(spec.kind).join(', ')}`
    )
  }
  if (format === 'proto') return exportProto(spec)
  if (format === 'graphql') return exportGraphql(spec)
  return exportOpenapi(spec)
}
