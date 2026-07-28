import { describe, expect, it } from 'vitest'
import { YamlError, parseJsonOrYaml, parseYaml } from './yaml'

/**
 * YAML 부분집합 — 의존성 없이 OpenAPI 문서를 읽기 위한 최소 파서.
 * **핵심은 "읽는다"가 아니라 "모르면 거부한다"** — 조용히 잘못 읽으면 틀린 명세가 앉는다.
 */

describe('스칼라', () => {
  it('문자열·숫자·불리언·null 을 가른다', () => {
    expect(parseYaml('a: hello\nb: 42\nc: 3.5\nd: true\ne: null\nf: ~\ng:')).toEqual({
      a: 'hello',
      b: 42,
      c: 3.5,
      d: true,
      e: null,
      f: null,
      g: null
    })
  })

  it('따옴표를 벗기고 안의 특수문자를 지킨다', () => {
    expect(parseYaml(`a: "1"\nb: 'it''s'\nc: "줄\\n바꿈"\nd: "a: b"`)).toEqual({
      a: '1',
      b: "it's",
      c: '줄\n바꿈',
      d: 'a: b'
    })
  })

  it('주석을 뗀다 — 따옴표 안의 # 은 주석이 아니다', () => {
    expect(parseYaml('a: 1 # 설명\n# 통째 주석\nb: "x # y"')).toEqual({ a: 1, b: 'x # y' })
  })
})

describe('매핑과 시퀀스', () => {
  it('들여쓰기로 중첩한다', () => {
    expect(parseYaml('paths:\n  /users:\n    get:\n      summary: 목록')).toEqual({
      paths: { '/users': { get: { summary: '목록' } } }
    })
  })

  it('시퀀스를 읽는다', () => {
    expect(parseYaml('required:\n  - id\n  - name')).toEqual({ required: ['id', 'name'] })
  })

  it('시퀀스 항목이 매핑일 때', () => {
    expect(parseYaml('parameters:\n  - name: id\n    in: path\n    required: true\n  - name: q\n    in: query')).toEqual(
      {
        parameters: [
          { name: 'id', in: 'path', required: true },
          { name: 'q', in: 'query' }
        ]
      }
    )
  })

  it('시퀀스 항목 안에 다시 중첩이 있을 때', () => {
    expect(parseYaml('items:\n  - schema:\n      type: string\n    name: a')).toEqual({
      items: [{ schema: { type: 'string' }, name: 'a' }]
    })
  })

  it('빈 문서는 null 이다', () => {
    expect(parseYaml('')).toBeNull()
    expect(parseYaml('# 주석뿐')).toBeNull()
  })

  it('선행 --- 하나는 넘어간다', () => {
    expect(parseYaml('---\na: 1')).toEqual({ a: 1 })
  })
})

describe('흐름형(한 줄)', () => {
  it('목록과 매핑', () => {
    expect(parseYaml('required: [id, name]\nx: {a: 1, b: two}')).toEqual({
      required: ['id', 'name'],
      x: { a: 1, b: 'two' }
    })
  })

  it('중첩·따옴표·빈 것', () => {
    expect(parseYaml('a: [[1, 2], {b: "c, d"}]\nb: []\nc: {}')).toEqual({
      a: [[1, 2], { b: 'c, d' }],
      b: [],
      c: {}
    })
  })

  it('닫히지 않으면 거부한다', () => {
    expect(() => parseYaml('a: [1, 2')).toThrow(YamlError)
  })
})

describe('블록 스칼라', () => {
  it('| 은 줄바꿈을 지킨다', () => {
    expect(parseYaml('description: |\n  첫 줄\n  둘째 줄')).toEqual({ description: '첫 줄\n둘째 줄\n' })
  })

  it('> 는 한 줄로 접는다', () => {
    expect(parseYaml('description: >\n  첫 줄\n  둘째 줄')).toEqual({ description: '첫 줄 둘째 줄' })
  })

  it('|- 은 끝 줄바꿈을 없앤다', () => {
    expect(parseYaml('d: |-\n  한 줄')).toEqual({ d: '한 줄' })
  })
})

// ── 거부 — 이 파서의 값어치는 여기 있다 ──────────────────────────────────

describe('모르는 구문은 추측하지 않고 거부한다', () => {
  const cases: [string, RegExp][] = [
    ['a: &anchor 1\nb: *anchor', /앵커/],
    ['a: !!str 1', /태그/],
    ['base: &b {x: 1}\nc:\n  <<: *b', /병합 키|앵커/],
    ['---\na: 1\n---\nb: 2', /여러 문서/],
    ['a:\n\t- 1', /탭/],
    ['? [a, b]\n: 1', /복합 키/]
  ]

  for (const [src, re] of cases) {
    it(`거부: ${src.split('\n')[0]}`, () => {
      expect(() => parseYaml(src)).toThrow(re)
    })
  }

  it('오류에 몇 번째 줄인지 담긴다', () => {
    try {
      parseYaml('a: 1\nb: 2\nc: !!binary x')
      throw new Error('던졌어야 합니다')
    } catch (e) {
      expect((e as YamlError).line).toBe(3)
      expect((e as Error).message).toMatch(/3번째 줄/)
    }
  })

  it('들여쓰기가 어긋나면 조용히 넘어가지 않는다', () => {
    expect(() => parseYaml('a:\n  b: 1\n   c: 2')).toThrow(YamlError)
  })
})

describe('JSON 도 읽는다', () => {
  it('중괄호로 시작하면 JSON 으로 읽는다', () => {
    expect(parseJsonOrYaml('{"a": 1, "b": [2]}')).toEqual({ a: 1, b: [2] })
  })

  it('아니면 YAML 로 읽는다', () => {
    expect(parseJsonOrYaml('a: 1')).toEqual({ a: 1 })
  })
})

describe('실제 OpenAPI 조각', () => {
  it('경로·파라미터·응답이 한 덩어리로 읽힌다', () => {
    const doc = `openapi: 3.0.3
info:
  title: Billing
  version: "1.0"
paths:
  /users/{id}:
    get:
      summary: 사용자 조회
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: string
                  memo:
                    type: string
                    nullable: true`
    const parsed = parseYaml(doc) as any
    expect(parsed.openapi).toBe('3.0.3')
    expect(Object.keys(parsed.paths)).toEqual(['/users/{id}'])
    expect(parsed.paths['/users/{id}'].get.parameters[0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' }
    })
    expect(
      parsed.paths['/users/{id}'].get.responses['200'].content['application/json'].schema.properties.memo
    ).toEqual({ type: 'string', nullable: true })
  })
})
