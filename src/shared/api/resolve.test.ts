import { describe, expect, it } from 'vitest'
import { buildScope, missingRefs, resolveValue } from './resolve'
import type { EnvironmentDef, ParamDef } from './types'

/**
 * 값 해석 — `docs/qa/api-runner.md` S1 (CASE-apirunner-001~004).
 * 이 서비스의 핵심 모델: **환경 값**과 **호출 파라미터**는 다른 것이고 섞이지 않는다.
 */

const params: ParamDef[] = [
  { name: 'userId', type: 'string', required: true },
  { name: 'limit', type: 'number', required: false, defaultValue: '20' },
  { name: 'both', type: 'string', required: false, defaultValue: '기본값에서' }
]

const env: EnvironmentDef = {
  id: 'e1',
  specId: 's1',
  name: 'DEV',
  baseUrl: 'https://dev.example.com',
  production: false,
  values: [
    { name: 'apiKey', value: 'SEKRIT', secret: true },
    { name: 'tenant', value: 'acme', secret: false },
    { name: 'both', value: '환경에서', secret: false }
  ]
}

describe('CASE-apirunner-001 해석 순서: 기본값 < 환경 < 호출', () => {
  it('세 자리에 다 있으면 호출 파라미터가 이긴다', () => {
    const scope = buildScope({ params, env, call: { both: '호출에서' } })
    expect(scope.get('both')).toEqual({ value: '호출에서', origin: 'call', secret: false })
  })

  it('호출이 없으면 환경이 이긴다', () => {
    const scope = buildScope({ params, env, call: {} })
    expect(scope.get('both')).toEqual({ value: '환경에서', origin: 'environment', secret: false })
  })

  it('환경에도 없으면 기본값이 남는다', () => {
    const scope = buildScope({ params, env: { ...env, values: [] }, call: {} })
    expect(scope.get('both')).toEqual({ value: '기본값에서', origin: 'default', secret: false })
  })

  it('두 자리만 있어도 순서가 지켜진다', () => {
    const scope = buildScope({ params, env, call: { limit: '5' } })
    expect(scope.get('limit')?.origin).toBe('call')
    expect(scope.get('tenant')?.origin).toBe('environment')
  })
})

describe('CASE-apirunner-002 출처 표기', () => {
  it('해석된 모든 값에 출처가 붙는다 — 출처 없는 값이 없다', () => {
    const scope = buildScope({ params, env, call: { userId: 'u_1' } })
    for (const [name, v] of scope) {
      expect(v.origin, name).toBeTruthy()
    }
  })

  it('비밀 표식은 환경에서 그대로 따라온다', () => {
    const scope = buildScope({ params, env, call: {} })
    expect(scope.get('apiKey')?.secret).toBe(true)
    expect(scope.get('tenant')?.secret).toBe(false)
  })

  it('호출 파라미터가 비밀 환경값을 덮으면 더 이상 비밀이 아니다', () => {
    // 값의 출처가 바뀌었으므로 표식도 그 출처를 따라야 한다 — 아니면 사용자가 손으로 넣은
    // 값이 영문도 모른 채 가려진다.
    const scope = buildScope({ params, env, call: { apiKey: '내가-넣은-값' } })
    expect(scope.get('apiKey')).toEqual({ value: '내가-넣은-값', origin: 'call', secret: false })
  })
})

describe('CASE-apirunner-003 미해결 참조는 실행 전에 차단된다', () => {
  it('어디에도 없는 이름을 찾아낸다', () => {
    const scope = buildScope({ params, env, call: {} })
    expect(missingRefs(['tenant', 'nope', 'userId'], scope)).toEqual(['nope', 'userId'])
  })

  it('resolveValue 는 없는 이름에 undefined 를 주고 빈 문자열을 지어내지 않는다', () => {
    const scope = buildScope({ params, env, call: {} })
    expect(resolveValue('nope', scope)).toBeUndefined()
    expect(resolveValue('tenant', scope)?.value).toBe('acme')
  })

  it('빈 문자열 값은 "없음"이 아니다 — 일부러 빈 값을 넣은 것과 구분한다', () => {
    const scope = buildScope({ params, env, call: { userId: '' } })
    expect(missingRefs(['userId'], scope)).toEqual([])
    expect(resolveValue('userId', scope)).toEqual({ value: '', origin: 'call', secret: false })
  })
})

describe('CASE-apirunner-004 두 바구니는 섞이지 않는다', () => {
  it('환경 값과 호출 파라미터를 갈래별로 따로 셀 수 있다', () => {
    const scope = buildScope({ params, env, call: { userId: 'u_1' } })
    const origins = [...scope.values()].map((v) => v.origin)
    expect(origins.filter((o) => o === 'environment')).toEqual(['environment', 'environment', 'environment']) // apiKey · tenant · both
    expect(origins.filter((o) => o === 'call')).toHaveLength(1) // userId
    expect(origins.filter((o) => o === 'default')).toHaveLength(1) // limit (both 은 환경이 이겼다)
  })

  it('이름이 같아도 어느 갈래에서 이겼는지 끝까지 남는다', () => {
    const scope = buildScope({ params, env, call: { both: 'X' } })
    expect(scope.get('both')?.origin).toBe('call')
    const noCall = buildScope({ params, env, call: {} })
    expect(noCall.get('both')?.origin).toBe('environment')
  })

  it('환경이 없어도(선택 전) 파라미터만으로 해석된다', () => {
    const scope = buildScope({ params, env: null, call: { userId: 'u_1' } })
    expect(scope.get('userId')?.origin).toBe('call')
    expect(scope.get('apiKey')).toBeUndefined()
  })
})
