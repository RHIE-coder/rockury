import { describe, expect, it } from 'vitest'
import { applyKeywords, extractKeywords, formatValue } from './keywords'

describe('extractKeywords', () => {
  it('bare 키워드만, 등장 순서·유일', () => {
    expect(extractKeywords('SELECT * FROM t WHERE a = {{a}} AND b = {{ b }} AND c = {{a}}')).toEqual(['a', 'b'])
  })
  it("작은따옴표로 감싼 '{{x}}' 는 제외", () => {
    expect(extractKeywords("SELECT '{{lit}}', {{real}}")).toEqual(['real'])
  })
  it('없으면 빈 배열', () => {
    expect(extractKeywords('SELECT 1')).toEqual([])
  })
})

describe('formatValue', () => {
  it('숫자는 raw', () => {
    expect(formatValue('42')).toBe('42')
    expect(formatValue('-3.14')).toBe('-3.14')
  })
  it('NULL 은 raw', () => {
    expect(formatValue('null')).toBe('NULL')
  })
  it('문자열은 싱글쿼트+이스케이프', () => {
    expect(formatValue('hi')).toBe("'hi'")
    expect(formatValue("O'Brien")).toBe("'O''Brien'")
  })
})

describe('applyKeywords', () => {
  it('bare 치환(문자열 자동 쿼트, 숫자 raw)', () => {
    expect(applyKeywords('WHERE name = {{n}} AND age = {{age}}', { n: 'kim', age: '30' })).toBe(
      "WHERE name = 'kim' AND age = 30"
    )
  })
  it("quoted '{{x}}' 는 그대로 둔다", () => {
    expect(applyKeywords("SELECT '{{lit}}', {{v}}", { lit: 'X', v: 'Y' })).toBe("SELECT '{{lit}}', 'Y'")
  })
  it('값 없는 키워드는 그대로', () => {
    expect(applyKeywords('WHERE a = {{a}}', {})).toBe('WHERE a = {{a}}')
  })
})
