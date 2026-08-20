import { describe, expect, it } from 'vitest'
import { BUILTIN_FUNCTIONS, callFunction, suggestFunction } from './functions'
import { nodeFunctionEnv } from './nodeFunctionEnv'

/**
 * 내장 함수 정본 검증 — CASE-apistudio-015~019, 01A.
 * 값 가공은 이 목록으로만 한다(불변식 ⑤) — 그래서 목록 전체가 테스트로 덮여야 한다.
 */

/** 고정 시각·고정 난수를 주입한 환경 — 비결정 함수를 결정적으로 만든다. */
const fixed = {
  ...nodeFunctionEnv,
  now: () => Date.UTC(2026, 6, 28, 9, 5, 3, 42), // 2026-07-28T09:05:03.042Z
  random: () => 0.5,
  uuid: () => '11111111-2222-4333-8444-555555555555'
}

const call = (name: string, ...args: string[]): string => callFunction(name, args, fixed)

describe('내장 함수 — 목록 자체', () => {
  it('spec §5 목록과 개수·이름이 일치한다 (임의 추가·누락 금지)', () => {
    expect(BUILTIN_FUNCTIONS.map((f) => f.name).sort()).toEqual(
      [
        'base64',
        'base64decode',
        'hmac',
        'isoDate',
        'json',
        'lower',
        'md5',
        'now',
        'random',
        'replace',
        'sha1',
        'sha256',
        'timestamp',
        'trim',
        'upper',
        'urldecode',
        'urlencode',
        'uuid'
      ].sort()
    )
  })

  it('모든 함수가 사용법과 한 줄 설명을 갖는다 — 편집기 도움말의 원천', () => {
    for (const f of BUILTIN_FUNCTIONS) {
      expect(f.usage, f.name).toMatch(new RegExp(`^${f.name}\\(`))
      expect(f.blurb.length, f.name).toBeGreaterThan(0)
    }
  })
})

// CASE-apistudio-018 — 비결정 함수의 주입 가능성
describe('CASE-apistudio-018 비결정 함수는 주입된 시각원·난수원을 쓴다', () => {
  it('now/timestamp/isoDate 가 주입 시각을 따른다', () => {
    expect(call('now')).toBe('2026-07-28 09:05:03')
    expect(call('timestamp')).toBe(String(Date.UTC(2026, 6, 28, 9, 5, 3, 42)))
    expect(call('isoDate')).toBe('2026-07-28T09:05:03.042Z')
  })

  it('uuid/random 이 주입 난수원을 따른다 — 두 번 불러도 같다', () => {
    expect(call('uuid')).toBe('11111111-2222-4333-8444-555555555555')
    expect(call('uuid')).toBe(call('uuid'))
    expect(call('random', '1', '10')).toBe(call('random', '1', '10'))
  })

  it('random 은 경계를 포함한다', () => {
    const low = { ...fixed, random: () => 0 }
    const high = { ...fixed, random: () => 0.999999 }
    expect(callFunction('random', ['3', '7'], low)).toBe('3')
    expect(callFunction('random', ['3', '7'], high)).toBe('7')
  })

  it('random 은 min > max 를 거부한다', () => {
    expect(() => call('random', '9', '2')).toThrow(/min.*max/)
  })
})

// CASE-apistudio-019 — now(포맷)
describe('CASE-apistudio-019 now(포맷)', () => {
  it('지원 토큰을 정확히 치환한다 (UTC 고정)', () => {
    expect(call('now', 'YYYY/MM/DD')).toBe('2026/07/28')
    expect(call('now', 'HH:mm:ss.SSS')).toBe('09:05:03.042')
  })

  it('대괄호 안은 글자 그대로 둔다', () => {
    expect(call('now', 'YYYY-MM-DD[T]HH:mm:ss[Z]')).toBe('2026-07-28T09:05:03Z')
  })

  it('모르는 토큰이 섞이면 거부하고 그 토큰을 지목한다', () => {
    expect(() => call('now', 'YYYY-QQ')).toThrow(/QQ/)
  })
})

// CASE-apistudio-015 — 인코딩
describe('CASE-apistudio-015 인코딩 함수', () => {
  it('base64 왕복이 일치한다 (비ASCII·빈 문자열 포함)', () => {
    for (const s of ['abc', '한글 값', '', 'a+b/c=']) {
      expect(call('base64decode', call('base64', s))).toBe(s)
    }
  })

  it('urlencode 왕복이 일치한다', () => {
    for (const s of ['a b&c=d', '한글', '']) {
      expect(call('urldecode', call('urlencode', s))).toBe(s)
    }
  })

  it('깨진 base64 는 조용히 빈 값을 내지 않고 거부한다', () => {
    expect(() => call('base64decode', '!!!not-base64!!!')).toThrow()
  })

  it('json 은 JSON 본문에 그대로 꽂을 수 있게 따옴표까지 붙여 이스케이프한다', () => {
    expect(call('json', 'a"b')).toBe('"a\\"b"')
    expect(call('json', '줄\n바꿈')).toBe('"줄\\n바꿈"')
  })
})

// CASE-apistudio-016 — 해시·서명
describe('CASE-apistudio-016 해시·서명 함수', () => {
  it('md5/sha1/sha256 이 알려진 벡터와 일치한다', () => {
    expect(call('md5', 'abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(call('sha1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(call('sha256', 'abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('hmac 이 알려진 벡터와 일치한다 — 이 함수가 코드 실행을 대체한다(불변식 ⑤)', () => {
    expect(call('hmac', 'sha256', 'key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    )
  })

  it('미지원 알고리즘은 거부하고 지원 목록을 알린다', () => {
    expect(() => call('hmac', 'rot13', 'k', 'v')).toThrow(/sha256/)
  })
})

// CASE-apistudio-017 — 문자열
describe('CASE-apistudio-017 문자열 함수', () => {
  it('upper/lower/trim 이 빈 값·유니코드에서 안전하다', () => {
    expect(call('upper', 'aÄ')).toBe('AÄ')
    expect(call('lower', 'AÄ')).toBe('aä')
    expect(call('trim', '  한글  ')).toBe('한글')
    expect(call('trim', '')).toBe('')
  })

  it('replace 는 모든 자리를 바꾼다 (정규식이 아니라 글자 그대로)', () => {
    expect(call('replace', 'a.b.c', '.', '-')).toBe('a-b-c')
    expect(call('replace', 'aaa', 'a', '')).toBe('')
  })
})

// CASE-apistudio-01A — 인자 개수 검증과 오타 제안
describe('CASE-apistudio-01A 인자 검증 · 미상 함수', () => {
  it('인자 개수가 안 맞으면 거부하고 기대 인자를 알린다', () => {
    expect(() => call('hmac', 'sha256')).toThrow(/hmac\(/)
    expect(() => call('upper')).toThrow(/upper\(/)
    expect(() => call('uuid', '군더더기')).toThrow(/uuid\(/)
  })

  it('목록에 없는 함수는 거부하고 가장 가까운 이름을 제안한다', () => {
    expect(() => call('base64encode', 'x')).toThrow(/base64/)
    expect(suggestFunction('upprer')).toBe('upper')
    expect(suggestFunction('sha256')).toBe('sha256')
  })

  it('전혀 닮지 않은 이름에는 억지 제안을 하지 않는다', () => {
    expect(suggestFunction('zzzzzzzzzz')).toBeNull()
  })
})
