import { describe, expect, it } from 'vitest'
import { balancedParens, stripCheckKeyword, stripOuterParens } from './sqlText'

describe('balancedParens', () => {
  it('짝이 맞는 괄호의 안쪽을 돌려준다', () => {
    expect(balancedParens('CHECK (a > 0) 뒤', 6)).toEqual({ inner: 'a > 0', end: 12 })
  })

  it('중첩 괄호를 끝까지 센다', () => {
    expect(balancedParens('((a) and (b))', 0)?.inner).toBe('(a) and (b)')
  })

  it('따옴표 안의 괄호는 세지 않는 다 — `)` 가 글자일 때 끊기면 식이 잘린다', () => {
    expect(balancedParens("(name <> ')')", 0)?.inner).toBe("name <> ')'")
  })

  it('겹쳐 쓴 따옴표는 글자 하나로 본다', () => {
    expect(balancedParens("(s <> 'it''s)')", 0)?.inner).toBe("s <> 'it''s)'")
  })

  it('짝이 안 맞으면 null — 잘린 DDL 을 억지로 읽지 않는다', () => {
    expect(balancedParens('(a > 0', 0)).toBeNull()
  })
})

describe('stripOuterParens', () => {
  it('전체를 감싼 괄호 한 겹만 벗긴다', () => {
    expect(stripOuterParens('((a > 0))')).toBe('(a > 0)')
  })

  it('전체를 감싼 게 아니면 그대로 둔다', () => {
    expect(stripOuterParens('(a) AND (b)')).toBe('(a) AND (b)')
  })

  it('괄호로 시작하지 않으면 그대로 둔다', () => {
    expect(stripOuterParens('a > 0')).toBe('a > 0')
  })
})

describe('stripCheckKeyword', () => {
  it('PostgreSQL 의 `CHECK ((expr))` 에서 식만 남긴다', () => {
    expect(stripCheckKeyword('CHECK ((price > 0))')).toBe('price > 0')
  })

  it('식 안에 괄호가 남아야 하면 남긴다', () => {
    expect(stripCheckKeyword('CHECK (((a > 0) AND (b > 0)))')).toBe('(a > 0) AND (b > 0)')
  })
})
