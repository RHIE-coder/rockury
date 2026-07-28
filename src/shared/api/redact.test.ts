import { describe, expect, it } from 'vitest'
import { redactHeaders, redactText, secretValues } from './redact'
import { MASK } from './template'
import type { EnvValue } from './types'

/**
 * 아는 비밀 지우기 — `docs/qa/api-runner.md` CASE-apirunner-032 (기록 마스킹).
 * 요청만 가리면 **응답이 되돌려준 값**이 그대로 남는다는 것을 실측으로 잡았다.
 */

const vals = (...v: EnvValue[]): EnvValue[] => v

describe('지울 대상 고르기', () => {
  it('비밀 표식이 켜진 값만 고른다', () => {
    expect(
      secretValues(
        vals(
          { name: 'k', value: 'SECRET-VALUE', secret: true },
          { name: 't', value: 'public-tenant', secret: false }
        )
      )
    ).toContain('SECRET-VALUE')
  })

  it('같은 비밀의 **다른 표기**도 지울 목록에 든다 — 서버가 그 형태로 되돌려준다', () => {
    // 쿼리에 실었으면 URL 인코딩되어 오고, `{{base64(key)}}` 로 보냈으면 base64 로 에코된다.
    const got = secretValues(vals({ name: 'k', value: 'AB+cd/ef=ghij', secret: true }))
    expect(got).toContain('AB+cd/ef=ghij')
    expect(got).toContain('AB%2Bcd%2Fef%3Dghij')
    expect(got).toContain(btoa('AB+cd/ef=ghij'))
    // 대소문자만 바꿔 되돌려주는 서버도 있다.
    expect(got).toContain('ab+cd/ef=ghij')
  })

  it('해시·서명은 못 지운다 — 되돌릴 수 없어 만들 수가 없다(한계를 분명히 둔다)', () => {
    // 이 한계 때문에 MCP 에는 본문을 아예 주지 않고 모양까지만 준다.
    const got = secretValues(vals({ name: 'k', value: 'SECRET-VALUE', secret: true }))
    expect(got.every((v) => !/^[0-9a-f]{32}$/.test(v))).toBe(true)
  })

  it('너무 짧은 값은 안 지운다 — 본문이 걸레가 되어 읽을 수 없게 된다', () => {
    expect(secretValues(vals({ name: 'k', value: 'ab', secret: true }))).toEqual([])
    expect(secretValues(vals({ name: 'k', value: '', secret: true }))).toEqual([])
  })

  it('긴 것부터 지운다 — 짧은 값이 긴 값의 일부일 때 순서가 결과를 가른다', () => {
    const got = secretValues(
      vals(
        { name: 'a', value: 'TOKEN', secret: true },
        { name: 'b', value: 'TOKEN-LONGER', secret: true }
      )
    )
    // 표기 변형이 섞여도 **길이 내림차순**이 지켜져야 한다 — 짧은 값이 긴 값을 잘라 먹으면
    // 긴 값이 통째로 안 지워진다.
    expect(got).toEqual([...got].sort((a, b) => b.length - a.length))
    expect(got.indexOf('TOKEN-LONGER')).toBeLessThan(got.indexOf('TOKEN'))
    expect(redactText('TOKEN-LONGER', got)).toBe(MASK)
  })
})

describe('본문·헤더에서 지우기', () => {
  const secrets = ['REAL-SECRET']

  it('응답이 되돌려준 비밀도 지운다 (키를 에코하는 서버)', () => {
    expect(redactText('{"seen":"Bearer REAL-SECRET"}', secrets)).toBe(`{"seen":"Bearer ${MASK}"}`)
  })

  it('여러 번 나와도 전부 지운다', () => {
    expect(redactText('REAL-SECRET and REAL-SECRET', secrets)).toBe(`${MASK} and ${MASK}`)
  })

  it('헤더 값도 훑는다', () => {
    expect(redactHeaders({ 'x-echo': 'REAL-SECRET', ok: 'fine' }, secrets)).toEqual({
      'x-echo': MASK,
      ok: 'fine'
    })
  })

  it('지울 게 없으면 원문 그대로다', () => {
    expect(redactText('아무것도 없음', secrets)).toBe('아무것도 없음')
    expect(redactText('REAL-SECRET', [])).toBe('REAL-SECRET')
  })

  it('우리가 모르는 값은 못 지운다 — 그래서 MCP 에는 본문을 안 준다', () => {
    // 서버가 새로 발급한 토큰. 우리 환경 값이 아니므로 여기서는 손댈 수 없다.
    expect(redactText('{"accessToken":"srv-issued-xyz"}', secrets)).toContain('srv-issued-xyz')
  })
})
