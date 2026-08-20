import { describe, expect, it } from 'vitest'
import { observedShape, shapeOfBody, typeOf } from './observed'

/**
 * 관측 모양 뽑기 — CASE-apistudio-077 (관측에서 제안)
 * + `api-mcp.md` tools.read AC-3 (AI 에게는 모양까지).
 */

describe('타입 판정', () => {
  it('JSON 값 갈래를 가른다', () => {
    expect(typeOf(null)).toBe('null')
    expect(typeOf([])).toBe('array')
    expect(typeOf({})).toBe('object')
    expect(typeOf(1)).toBe('number')
    expect(typeOf('s')).toBe('string')
    expect(typeOf(true)).toBe('boolean')
  })
})

describe('필수여부를 함부로 못 박지 않는다', () => {
  it('값이 있었다고 해서 required 라고 적지 않는다 — 한 번 봐서는 모른다', () => {
    const shape = observedShape({ id: 'u_1' })
    expect(shape[0].requiredness).toBe('unknown')
  })

  it('null 을 본 것은 "없을 수 있다"는 관측이므로 nullable 로 적는다', () => {
    expect(observedShape({ memo: null })[0].requiredness).toBe('nullable')
  })
})

describe('중첩·배열', () => {
  it('중첩 객체를 따라 들어간다', () => {
    const shape = observedShape({ user: { email: 'a@b.c' } })
    expect(shape[0].type).toBe('object')
    expect(shape[0].fields?.[0].name).toBe('email')
  })

  it('배열은 원소들의 키를 합친다 — 첫 원소만 보면 뒤에서 늘어난 필드를 놓친다', () => {
    const shape = observedShape([{ a: 1 }, { a: 1, b: 2 }])
    expect(shape[0].type).toBe('array')
    expect(shape[0].fields?.map((f) => f.name)).toEqual(['a', 'b'])
  })

  it('원소마다 null 이 섞이면 그 필드는 nullable 로 남는다', () => {
    const shape = observedShape([{ a: 1 }, { a: null }])
    expect(shape[0].fields?.[0].requiredness).toBe('nullable')
  })

  it('빈 배열·원시값 배열은 모양이 없다', () => {
    expect(observedShape([])).toEqual([])
    expect(observedShape([1, 2])).toEqual([])
  })

  it('원시값 자체는 모양이 없다', () => {
    expect(observedShape('hello')).toEqual([])
    expect(observedShape(null)).toEqual([])
  })
})

describe('본문 파싱', () => {
  it('JSON 이면 모양을 준다', () => {
    const r = shapeOfBody('{"id":"u","memo":null}')
    expect(r.json).toBe(true)
    expect(r.shape.map((f) => [f.name, f.requiredness])).toEqual([
      ['id', 'unknown'],
      ['memo', 'nullable']
    ])
  })

  it('JSON 이 아니면 "빈 모양" 이 아니라 "JSON 아님" 으로 구분된다', () => {
    const r = shapeOfBody('<html>오류</html>')
    expect(r.json).toBe(false)
    expect(r.shape).toEqual([])
  })

  it('빈 본문도 JSON 아님이다 (응답이 없다는 뜻과 섞지 않는다)', () => {
    expect(shapeOfBody('').json).toBe(false)
  })
})
