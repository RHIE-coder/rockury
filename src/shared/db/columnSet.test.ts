import { describe, it, expect } from 'vitest'
import { sanitizeColumnSet } from './columnSet'

describe('sanitizeColumnSet — 저장 전 정제', () => {
  const ok = { name: 'created_at', type: 'DATETIME', nullable: false, defaultValue: 'now()', comment: '생성 시각' }

  it('멀쩡한 줄은 그대로 통과한다', () => {
    expect(sanitizeColumnSet([ok])).toEqual([ok])
  })

  it('id·drift 는 안 담는다 — 저장해 둔 id 를 그대로 쓰면 같은 id 가 두 표에 들어간다', () => {
    const got = sanitizeColumnSet([{ ...ok, id: 'col-9', drift: { version: 'v0.2.0' } } as never])
    expect(got[0]).not.toHaveProperty('id')
    expect(got[0]).not.toHaveProperty('drift')
  })

  it('이름 없는 줄은 버리고 이름의 앞뒤 공백은 턴다', () => {
    expect(sanitizeColumnSet([{ ...ok, name: '  ' }, { ...ok, name: '  memo  ' }]).map((c) => c.name)).toEqual(['memo'])
  })

  it('빠진 값은 기본으로 채운다 — 손상된 저장분을 읽어도 화면이 안 죽는다', () => {
    const got = sanitizeColumnSet([{ name: 'x' } as never])
    expect(got[0]).toEqual({ name: 'x', type: '', nullable: true, defaultValue: null, comment: '' })
  })

  it('nullable 은 false 일 때만 false — 값이 없으면 널 허용으로 본다', () => {
    expect(sanitizeColumnSet([{ ...ok, nullable: undefined } as never])[0].nullable).toBe(true)
  })
})
