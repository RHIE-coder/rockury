import { describe, expect, it } from 'vitest'
import { duplicateKeys, isValidKey, keyProblem, parseSpecAddress, specAddress } from './address'

describe('주소 조각 규칙 (INV-2)', () => {
  it('CASE-uiux-020 소문자·숫자로 시작하는 소문자 영숫자·하이픈·밑줄만 통과한다', () => {
    for (const ok of ['login', 'a', '2fa', 'sign-up', 'my_page', 'v2-beta']) {
      expect(isValidKey(ok), ok).toBe(true)
    }
    for (const no of ['', 'Login', '로그인', 'sign up', '-lead', '_lead', 'a.b']) {
      expect(isValidKey(no), no).toBe(false)
    }
  })

  it('CASE-uiux-021 왜 안 되는지 사람 말로 알려준다 (화면이 그대로 보여줄 문구)', () => {
    expect(keyProblem('login')).toBeNull()
    expect(keyProblem('')).toContain('비어')
    expect(keyProblem('a.b')).toContain('점')
    expect(keyProblem('sign up')).toContain('공백')
    expect(keyProblem('Login')).toContain('소문자')
    expect(keyProblem('-lead')).toContain('시작')
    // 한글로 시작하면 "시작 글자" 안내가 먼저 걸린다 — 이름은 name 에 따로 두면 된다.
    expect(keyProblem('로그인')).toContain('시작')
    expect(keyProblem('login로그인')).toContain('하이픈')
  })
})

describe('주소 만들기·되돌리기', () => {
  it('CASE-uiux-022 층을 순서대로 이어 붙인다', () => {
    expect(specAddress('coupang', 'buyer', 'auth', 'login')).toBe('coupang.buyer.auth.login')
    expect(specAddress('coupang', 'buyer')).toBe('coupang.buyer')
    expect(specAddress('coupang')).toBe('coupang')
  })

  it('CASE-uiux-022 잘못된 조각은 던진다 — 잘못된 주소가 데이터에 남으면 나중에 조용히 안 걸린다', () => {
    expect(() => specAddress('coupang', 'Buyer')).toThrow(/application/)
    expect(() => specAddress('coupang', 'a.b')).toThrow(/점/)
    expect(() => specAddress()).toThrow()
    expect(() => specAddress('a', 'b', 'c', 'd', 'e')).toThrow()
  })

  it('CASE-uiux-023 주소를 층으로 되돌린다', () => {
    expect(parseSpecAddress('coupang.buyer.auth.login')).toEqual({
      project: 'coupang',
      application: 'buyer',
      service: 'auth',
      surface: 'login',
      depth: 4
    })
    const app = parseSpecAddress('coupang.buyer')
    expect(app?.depth).toBe(2)
    expect(app?.service).toBeUndefined()
  })

  it('CASE-uiux-023 주소가 아닌 것은 null (예외가 아니라 판정)', () => {
    expect(parseSpecAddress('')).toBeNull()
    expect(parseSpecAddress('coupang..login')).toBeNull()
    expect(parseSpecAddress('Coupang.buyer')).toBeNull()
    expect(parseSpecAddress('a.b.c.d.e')).toBeNull()
  })

  it('CASE-uiux-023 만든 주소는 그대로 되돌아온다 (왕복)', () => {
    const addr = specAddress('coupang', 'buyer', 'auth', 'login')
    const back = parseSpecAddress(addr)
    expect(back && specAddress(back.project, back.application!, back.service!, back.surface!)).toBe(addr)
  })
})

describe('같은 부모 아래 key 충돌 (INV-1)', () => {
  it('CASE-uiux-024 겹친 key 를 한 번씩 돌려준다', () => {
    expect(duplicateKeys([{ key: 'a' }, { key: 'b' }])).toEqual([])
    expect(duplicateKeys([{ key: 'a' }, { key: 'a' }])).toEqual(['a'])
    expect(duplicateKeys([{ key: 'a' }, { key: 'a' }, { key: 'a' }])).toEqual(['a'])
    expect(duplicateKeys([])).toEqual([])
  })
})
