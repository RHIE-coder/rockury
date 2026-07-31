import { describe, expect, it } from 'vitest'
import { genUuid, isUuidV4 } from './genValue'

describe('isUuidV4', () => {
  it('유효한 v4 를 통과', () => {
    expect(isUuidV4('66a8b299-5c42-49e8-a248-cd9485e787b5')).toBe(true)
  })
  it('형식이 아니면 거부', () => {
    expect(isUuidV4('not-uuid')).toBe(false)
    expect(isUuidV4('66a8b299-5c42-19e8-a248-cd9485e787b5')).toBe(false) // 버전 자리 1
    expect(isUuidV4('')).toBe(false)
  })
})

describe('genUuid', () => {
  it('유효한 UUID v4 를 만든다', () => {
    const u = genUuid()
    expect(isUuidV4(u)).toBe(true)
  })
  it('매번 다른 값', () => {
    expect(genUuid()).not.toBe(genUuid())
  })
})
