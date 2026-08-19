import { describe, expect, it } from 'vitest'
import { DIALECT_IDS } from '@shared/dialects'
import { GLYPH } from './DialectMark'

/**
 * 글리프는 손으로 옮겨 심는다(simple-icons 발췌). 벤더를 새로 더하면서 글리프를 빼먹으면
 * 화면엔 아무 오류 없이 **빈 자리**만 남는다 — 눈으로 못 잡으니 여기서 잡는다.
 */
describe('DialectMark 글리프', () => {
  it('방언마다 하나씩 있다', () => {
    expect(Object.keys(GLYPH).sort()).toEqual([...DIALECT_IDS].sort())
  })

  it('그릴 수 있는 path 다', () => {
    for (const id of DIALECT_IDS) {
      expect(GLYPH[id], id).toMatch(/^M/)
      expect(GLYPH[id].length, id).toBeGreaterThan(100)
    }
  })
})
