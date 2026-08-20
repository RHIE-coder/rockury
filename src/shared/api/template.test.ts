import { describe, expect, it } from 'vitest'
import { MASK, assertRenderable, collectRefs, renderTemplate } from './template'
import { buildScope } from './resolve'
import { callFunction, cryptoUnavailable } from './functions'
import { nodeFunctionEnv } from './nodeFunctionEnv'
import type { EnvironmentDef, ParamDef } from './types'

/**
 * 템플릿 치환 — CASE-apistudio-010~014, 01A.
 * + 미리보기 마스킹(CASE-apirunner-021).
 */

const env = {
  ...nodeFunctionEnv,
  now: () => Date.UTC(2026, 6, 28, 9, 5, 3, 42),
  uuid: () => 'fixed-uuid',
  random: () => 0.5
}

const params: ParamDef[] = [{ name: 'userId', type: 'string', required: true }]
const environment: EnvironmentDef = {
  id: 'e1',
  specId: 's1',
  name: 'DEV',
  baseUrl: 'https://dev.example.com',
  production: false,
  values: [
    { name: 'tenant', value: 'acme', secret: false },
    { name: 'apiKey', value: 'SEKRIT', secret: true }
  ]
}
const scope = buildScope({ params, env: environment, call: { userId: 'u_1' } })

const render = (text: string, maskSecrets = false) =>
  renderTemplate(text, { scope, env, maskSecrets })

describe('CASE-apistudio-010 참조 치환', () => {
  it('이름을 값으로 바꾼다', () => {
    expect(render('/orgs/{{tenant}}/users/{{userId}}').text).toBe('/orgs/acme/users/u_1')
  })

  it('한 줄에 여러 번, 붙어 있어도 정확히 바꾼다', () => {
    expect(render('{{tenant}}{{userId}}').text).toBe('acmeu_1')
  })

  it('공백을 넉넉히 둬도 같은 이름으로 읽는다', () => {
    expect(render('{{  tenant  }}').text).toBe('acme')
  })

  it('쓴 이름과 출처를 함께 돌려준다', () => {
    const out = render('{{tenant}}/{{userId}}')
    expect(out.used).toEqual([
      { name: 'tenant', origin: 'environment', secret: false },
      { name: 'userId', origin: 'call', secret: false }
    ])
  })

  it('참조가 없는 글은 그대로 통과한다', () => {
    expect(render('/health').text).toBe('/health')
    expect(collectRefs('/health')).toEqual([])
  })
})

describe('CASE-apistudio-011 미상 참조는 조용히 비지 않는다', () => {
  it('없는 이름은 빈 문자열이 아니라 문제로 잡힌다', () => {
    const out = render('/x/{{nope}}')
    expect(out.issues).toHaveLength(1)
    expect(out.issues[0].kind).toBe('unknown-ref')
    expect(out.issues[0].ref).toBe('nope')
    // 미리보기에서는 어디가 문제인지 보이도록 원문을 남긴다.
    expect(out.text).toBe('/x/{{nope}}')
  })

  it('assertRenderable 이 전송을 막는다', () => {
    expect(() => assertRenderable(render('/x/{{nope}}'))).toThrow(/nope/)
    expect(() => assertRenderable(render('/x/{{tenant}}'))).not.toThrow()
  })

  it('collectRefs 가 검증용으로 이름만 먼저 뽑아 준다', () => {
    expect(collectRefs('{{a}}/{{b}}/{{a}}')).toEqual(['a', 'b'])
  })
})

describe('CASE-apistudio-012 이스케이프', () => {
  it('역슬래시를 앞에 붙이면 글자 그대로 남는다', () => {
    const out = render('literal \\{{tenant}} 끝')
    expect(out.text).toBe('literal {{tenant}} 끝')
    expect(out.used).toEqual([])
  })

  it('이스케이프된 자리는 참조로 세지 않는다', () => {
    expect(collectRefs('\\{{nope}}')).toEqual([])
  })
})

describe('CASE-apistudio-013 · 01A 함수 호출', () => {
  it('함수 호출과 참조를 가른다', () => {
    expect(render('{{uuid()}}').text).toBe('fixed-uuid')
    expect(render('{{userId}}').text).toBe('u_1')
  })

  it('인자에 참조·문자열 리터럴을 섞어 쓴다', () => {
    expect(render("{{upper(tenant)}}").text).toBe('ACME')
    expect(render("{{replace(tenant, 'a', 'A')}}").text).toBe('Acme')
  })

  it('중첩 호출이 안쪽부터 접힌다', () => {
    expect(render('{{base64(upper(tenant))}}').text).toBe('QUNNRQ==')
  })

  it('3겹 중첩(서명 → base64)이 직접 계산과 일치한다 — 코드 실행 없이 서명이 된다', () => {
    const sig = callFunction('hmac', ['sha256', 'SEKRIT', String(env.now())], env)
    const expected = callFunction('base64', [sig], env)
    expect(render("{{base64(hmac('sha256', apiKey, timestamp()))}}").text).toBe(expected)
  })

  it('함수 인자로 쓴 참조도 사용 목록에 남는다', () => {
    expect(render('{{upper(tenant)}}').used).toEqual([
      { name: 'tenant', origin: 'environment', secret: false }
    ])
  })

  it('인자 개수가 안 맞으면 문제로 잡힌다', () => {
    const out = render('{{upper()}}')
    expect(out.issues[0].kind).toBe('bad-args')
    expect(out.issues[0].message).toMatch(/upper\(/)
  })

  it('닫히지 않은 괄호는 문제로 잡힌다 — 조용히 넘어가지 않는다', () => {
    expect(render('{{upper(tenant}}').issues).toHaveLength(1)
  })
})

describe('CASE-apistudio-014 미상 함수', () => {
  it('없는 함수는 거부하고 가장 가까운 이름을 제안한다', () => {
    const out = render('{{base64encode(tenant)}}')
    expect(out.issues[0].kind).toBe('unknown-function')
    expect(out.issues[0].message).toMatch(/base64decode/)
  })
})

describe('CASE-apirunner-021 미리보기 마스킹 · 전송 시 계산', () => {
  it('비밀 표식 값은 미리보기에서 가려진다', () => {
    expect(render('key={{apiKey}}', true).text).toBe(`key=${MASK}`)
    expect(render('key={{apiKey}}', false).text).toBe('key=SEKRIT')
  })

  it('가려도 사용 목록에는 비밀이라는 사실이 남는다', () => {
    expect(render('{{apiKey}}', true).used).toEqual([
      { name: 'apiKey', origin: 'environment', secret: true }
    ])
  })

  it('암호 함수를 못 쓰는 환경에서는 막지 않고 "전송 시 계산"으로 미룬다', () => {
    const rendererEnv = { ...env, ...cryptoUnavailable }
    const out = renderTemplate("{{hmac('sha256', apiKey, 'x')}}", {
      scope,
      env: rendererEnv,
      maskSecrets: true
    })
    expect(out.issues.map((i) => i.kind)).toEqual(['deferred'])
    // deferred 는 전송을 막지 않는다 — 메인이 진짜로 계산한다.
    expect(() => assertRenderable(out)).not.toThrow()
  })
})
