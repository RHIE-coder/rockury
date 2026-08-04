import { describe, expect, it } from 'vitest'
import { rowToJson, viewCell } from './rowDetail'

describe('viewCell (행 상세의 값 판정)', () => {
  it('값 없음은 빈 문자열과 구분한다', () => {
    expect(viewCell(null)).toEqual({ kind: 'null' })
    expect(viewCell(undefined)).toEqual({ kind: 'null' })
    expect(viewCell('')).toEqual({ kind: 'text', text: '' })
  })

  it('드라이버가 객체로 준 JSON 컬럼을 들여써서 준다', () => {
    const v = viewCell({ a: 1, b: ['x'] })
    expect(v.kind).toBe('json')
    expect(v).toHaveProperty('text', '{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}')
  })

  it('문자열로 온 JSON 도 펴 준다 — 객체와 배열 둘 다', () => {
    expect(viewCell('{"a":1}')).toEqual({ kind: 'json', text: '{\n  "a": 1\n}' })
    expect(viewCell('  [1,2]  ')).toEqual({ kind: 'json', text: '[\n  1,\n  2\n]' })
  })

  // 회귀 방지: JSON.parse 만으로 가르면 이것들이 전부 "JSON 블록"이 되어
  // 숫자 한 칸이 코드 블록으로 그려진다.
  it('괄호로 시작하지 않는 값은 JSON 으로 보지 않는다', () => {
    expect(viewCell('123')).toEqual({ kind: 'text', text: '123' })
    expect(viewCell('true')).toEqual({ kind: 'text', text: 'true' })
    expect(viewCell('null')).toEqual({ kind: 'text', text: 'null' })
    expect(viewCell('"따옴표 문자열"')).toEqual({ kind: 'text', text: '"따옴표 문자열"' })
  })

  it('괄호로 시작하지만 깨진 JSON 은 고치지 않고 원문 그대로', () => {
    expect(viewCell('{"a":')).toEqual({ kind: 'text', text: '{"a":' })
  })

  it('숫자·불리언은 글자로', () => {
    expect(viewCell(42)).toEqual({ kind: 'text', text: '42' })
    expect(viewCell(false)).toEqual({ kind: 'text', text: 'false' })
  })

  it('Date 는 펴 봐야 읽을 게 없다 — 글자로', () => {
    expect(viewCell(new Date('2026-08-04T00:00:00.000Z'))).toEqual({
      kind: 'text',
      text: '2026-08-04T00:00:00.000Z'
    })
  })
})

describe('rowToJson (행 복사)', () => {
  it('컬럼 순서를 화면과 같게 맞추고, 없는 값은 null 로 채운다', () => {
    expect(rowToJson(['b', 'a', 'c'], { a: 1, b: 2 })).toBe('{\n  "b": 2,\n  "a": 1,\n  "c": null\n}')
  })
})
