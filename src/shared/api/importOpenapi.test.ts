import { describe, expect, it } from 'vitest'
import { ImportError, importOpenapi } from './importOpenapi'

/** OpenAPI 가져오기 — `docs/qa/api-studio.md` S3 (CASE-apistudio-020·023). */

const DOC = `openapi: 3.0.3
info:
  title: Billing API
  version: "1.0"
paths:
  /users/{id}:
    parameters:
      - name: traceId
        in: header
        schema:
          type: string
    get:
      operationId: getUser
      tags: [users]
      summary: 사용자 조회
      description: 자세한 설명
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: expand
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: 없음
          content:
            application/json:
              schema:
                type: object
                required: [message]
                properties:
                  message:
                    type: string
    delete:
      responses:
        '204':
          description: 지움
  /users:
    post:
      operationId: createUser
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: 만듦
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
components:
  schemas:
    User:
      type: object
      required: [id, role]
      properties:
        id:
          type: string
        age:
          type: integer
        memo:
          type: string
          nullable: true
        role:
          type: string
          enum: [admin, user]
        profile:
          type: object
          required: [bio]
          properties:
            bio:
              type: string`

describe('CASE-apistudio-020 OpenAPI → 요청', () => {
  const r = importOpenapi(DOC)

  it('제목을 명세 이름으로 쓴다', () => {
    expect(r.name).toBe('Billing API')
  })

  it('경로 × 메서드마다 요청을 만든다', () => {
    expect(r.requests.map((x) => x.name).sort()).toEqual(['createUser', 'deleteUsersId', 'getUser'].sort())
  })

  it('operationId 가 없으면 메서드+경로로 이름을 짓는다', () => {
    expect(r.requests.find((x) => x.request.method === 'DELETE')?.name).toBe('deleteUsersId')
  })

  it('메서드·경로를 옮긴다', () => {
    const get = r.requests.find((x) => x.name === 'getUser')!
    expect(get.request.method).toBe('GET')
    expect(get.request.path).toBe('/users/{id}')
  })

  it('경로 파라미터는 필수로, 쿼리는 템플릿 자리로 옮긴다', () => {
    const get = r.requests.find((x) => x.name === 'getUser')!
    expect(get.params.find((p) => p.name === 'id')).toMatchObject({ type: 'string', required: true })
    expect(get.params.find((p) => p.name === 'expand')).toMatchObject({
      type: 'boolean',
      required: false,
      defaultValue: 'false'
    })
    expect(get.request.query).toEqual({ expand: '{{expand}}' })
  })

  it('경로 공통 파라미터도 합친다 (헤더)', () => {
    const get = r.requests.find((x) => x.name === 'getUser')!
    expect(get.params.some((p) => p.name === 'traceId')).toBe(true)
    expect(get.request.headers).toEqual({ traceId: '{{traceId}}' })
  })

  it('문서 안 $ref 를 따라간다', () => {
    const ok = r.requests.find((x) => x.name === 'getUser')!.responses.find((x) => x.status === '200')!
    expect(ok.fields.map((f) => f.name)).toEqual(['id', 'age', 'memo', 'role', 'profile'])
  })

  it('required 목록과 nullable 을 필수여부로 정확히 옮긴다 — 여기엔 "모름" 이 없다', () => {
    const ok = r.requests.find((x) => x.name === 'getUser')!.responses.find((x) => x.status === '200')!
    expect(ok.fields.find((f) => f.name === 'id')?.requiredness).toBe('required')
    expect(ok.fields.find((f) => f.name === 'age')?.requiredness).toBe('nullable') // required 목록에 없음
    expect(ok.fields.find((f) => f.name === 'memo')?.requiredness).toBe('nullable') // nullable: true
    expect(ok.fields.every((f) => f.requiredness !== 'unknown')).toBe(true)
  })

  it('타입·열거값·중첩을 옮긴다', () => {
    const ok = r.requests.find((x) => x.name === 'getUser')!.responses.find((x) => x.status === '200')!
    expect(ok.fields.find((f) => f.name === 'age')?.type).toBe('number')
    expect(ok.fields.find((f) => f.name === 'role')?.enumValues).toEqual(['admin', 'user'])
    expect(ok.fields.find((f) => f.name === 'profile')?.fields?.[0].name).toBe('bio')
  })

  it('상태를 모두 옮긴다 (본문 없는 204 포함)', () => {
    expect(r.requests.find((x) => x.name === 'getUser')!.responses.map((x) => x.status)).toEqual(['200', '404'])
    expect(r.requests.find((x) => x.name === 'deleteUsersId')!.responses).toEqual([{ status: '204', fields: [] }])
  })

  it('summary·description 을 사람 문서로 옮긴다', () => {
    expect(r.requests.find((x) => x.name === 'getUser')!.docs).toBe('사용자 조회\n\n자세한 설명')
  })

  it('tag 를 폴더로 쓴다', () => {
    expect(r.requests.find((x) => x.name === 'getUser')!.folder).toBe('users')
  })

  it('JSON 본문이 있으면 빈 템플릿 자리를 만든다 — 예시 값을 지어내지 않는다', () => {
    expect(r.requests.find((x) => x.name === 'createUser')!.request.body).toBe('{\n  \n}')
  })

  it('JSON 문서도 읽는다', () => {
    const json = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'J' },
      paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } }
    })
    expect(importOpenapi(json).requests).toHaveLength(1)
  })
})

// CASE-apistudio-023 — 해석 못 한 항목 보고
describe('CASE-apistudio-023 못 옮긴 것은 버리지 않고 보고한다', () => {
  it('바깥 파일 참조', () => {
    const r = importOpenapi(`openapi: 3.0.0
info: {title: X}
paths:
  /a:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: 'other.yaml#/User'`)
    expect(r.unsupported.some((u) => u.includes('바깥 파일'))).toBe(true)
  })

  it('oneOf/anyOf/allOf', () => {
    const r = importOpenapi(`openapi: 3.0.0
info: {title: X}
paths:
  /a:
    get:
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  weird:
                    oneOf: [{type: string}, {type: number}]`)
    expect(r.unsupported.some((u) => u.includes('oneOf'))).toBe(true)
  })

  it('JSON 이 아닌 본문·응답', () => {
    const r = importOpenapi(`openapi: 3.0.0
info: {title: X}
paths:
  /a:
    post:
      requestBody:
        content:
          multipart/form-data:
            schema: {type: object}
      responses:
        '200':
          content:
            text/csv:
              schema: {type: string}`)
    expect(r.unsupported.some((u) => u.includes('multipart/form-data'))).toBe(true)
    expect(r.unsupported.some((u) => u.includes('text/csv'))).toBe(true)
  })

  it('옮기지 못하는 파라미터 위치(cookie)', () => {
    const r = importOpenapi(`openapi: 3.0.0
info: {title: X}
paths:
  /a:
    get:
      parameters:
        - name: sid
          in: cookie
          schema: {type: string}
      responses:
        '200': {description: ok}`)
    expect(r.unsupported.some((u) => u.includes('cookie'))).toBe(true)
  })

  it('가져올 경로가 없으면 조용히 성공하지 않는다', () => {
    const r = importOpenapi('openapi: 3.0.0\ninfo: {title: X}\npaths: {}')
    expect(r.requests).toEqual([])
    expect(r.unsupported.some((u) => u.includes('경로'))).toBe(true)
  })

  it('전부 옮겼으면 보고 목록이 비어 있다', () => {
    expect(importOpenapi(DOC).unsupported).toEqual([])
  })
})

describe('읽을 수 없는 문서는 분명히 거부한다', () => {
  it('OpenAPI 가 아니면 거부', () => {
    expect(() => importOpenapi('a: 1')).toThrow(ImportError)
    expect(() => importOpenapi('[]')).toThrow(/매핑이 아닙니다/)
  })

  it('Swagger 2.0 은 아직이라고 분명히 말한다', () => {
    expect(() => importOpenapi('swagger: "2.0"\ninfo: {title: X}')).toThrow(/Swagger 2\.0/)
  })

  it('YAML 이 깨졌으면 몇 번째 줄인지까지 전한다', () => {
    expect(() => importOpenapi('openapi: 3.0.0\na: &x 1')).toThrow(/2번째 줄/)
  })
})
