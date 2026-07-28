import { describe, expect, it } from 'vitest'
import { DEFAULT_TOKENS, diffTokens, mergeTokens, tokenGroup, tokenVarName } from './tokens'

/** 정의: `docs/qa/uiux-ia.md` S12 (CASE-uiux-100~102) · 명세: `docs/spec/uiux-ia.md` `uiux.style`. */

describe('토큰 병합', () => {
  it('CASE-uiux-100 덮어쓴 것만 바뀌고 나머지는 기본값 그대로', () => {
    const merged = mergeTokens({ 'color.primary': '#0f766e' })
    expect(merged['color.primary']).toBe('#0f766e')
    expect(merged['color.fg']).toBe(DEFAULT_TOKENS['color.fg'])
    expect(Object.keys(merged).length).toBe(Object.keys(DEFAULT_TOKENS).length)
  })

  it('CASE-uiux-100 덮어쓴 게 없으면 기본 한 벌을 그대로 쓴다', () => {
    expect(mergeTokens(undefined)).toBe(DEFAULT_TOKENS)
    expect(mergeTokens({})).toEqual(DEFAULT_TOKENS)
  })

  it('CASE-uiux-101 빈 값은 "기본으로 되돌림"이다 (지우기와 같은 뜻이라 따로 두지 않는다)', () => {
    expect(mergeTokens({ 'color.primary': '' })['color.primary']).toBe(DEFAULT_TOKENS['color.primary'])
    expect(mergeTokens({ 'color.primary': '   ' })['color.primary']).toBe(DEFAULT_TOKENS['color.primary'])
  })

  it('CASE-uiux-101 기본에 없는 이름도 받는다 (프로젝트가 자기 토큰을 더할 수 있다)', () => {
    expect(mergeTokens({ 'color.brandGold': '#c9a227' })['color.brandGold']).toBe('#c9a227')
  })

  it('CASE-uiux-102 저장할 땐 기본과 다른 것만 추린다 — 통째로 복사하면 기본이 좋아져도 못 따라온다', () => {
    const current = { ...DEFAULT_TOKENS, 'color.primary': '#0f766e' }
    expect(diffTokens(current)).toEqual({ 'color.primary': '#0f766e' })
    expect(diffTokens({ ...DEFAULT_TOKENS })).toEqual({})
  })

  it('CASE-uiux-102 병합 → 차이 추리기는 왕복이 맞는다', () => {
    const overrides = { 'color.primary': '#0f766e', 'space.md': '20px' }
    expect(diffTokens(mergeTokens(overrides))).toEqual(overrides)
  })
})

describe('토큰 이름', () => {
  it('CASE-uiux-102 경로 → CSS 변수, 그리고 묶음 갈래', () => {
    expect(tokenVarName('color.primary')).toBe('--t-color-primary')
    expect(tokenGroup('color.primary')).toBe('color')
    expect(tokenGroup('control.height')).toBe('control')
    expect(tokenGroup('')).toBe('etc')
  })
})
