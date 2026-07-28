import type { EnvironmentDef, ParamDef, ValueOrigin } from './types'

/**
 * 값 해석 — `docs/spec/api-service.md` §2, `api-runner.md` § environments.resolution.
 *
 * 이 서비스의 핵심 모델은 **값이 두 종류라는 것**이다:
 *   · 환경 값     — 환경마다 다르고 호출마다 같다 (base URL·API 키)
 *   · 호출 파라미터 — 환경과 무관하고 호출마다 다르다 (조회할 userId)
 * Postman 이 이 둘을 "변수" 한 바구니에 넣어서 컬렉션이 커지면 무엇이 무엇인지 모르게 된다.
 * 여기서는 해석이 끝난 뒤에도 **출처가 값에 붙어 다닌다** — 화면이 "이 값 어디서 왔나"를
 * 항상 보일 수 있어야 오조작(STG 인 줄 알고 PROD)을 막는다.
 *
 * 해석 순서(고정):  Request 기본값  <  Environment 값  <  호출 파라미터
 */

export interface ResolvedValue {
  value: string
  origin: ValueOrigin
  /**
   * 가려서 보여야 하는 값인가. **출처를 따라간다** — 사용자가 호출 파라미터로 직접 넣은
   * 값은 비밀이 아니다(자기가 방금 친 값이 영문도 모른 채 가려지면 안 된다).
   */
  secret: boolean
}

/** 이름 → 해석된 값. 삽입 순서는 기본값 → 환경 → 호출 이므로 화면에서 갈래별로 세기 쉽다. */
export type Scope = Map<string, ResolvedValue>

export interface ScopeInput {
  params: ParamDef[]
  /** 아직 환경을 안 골랐으면 null — 고르기 전에는 실행이 막힌다(guard AC-1). */
  env: EnvironmentDef | null
  /** 호출 시 사용자가 넣은 파라미터 값. 값이 없는 항목은 키 자체를 넣지 않는다. */
  call: Record<string, string>
}

export function buildScope({ params, env, call }: ScopeInput): Scope {
  const scope: Scope = new Map()

  for (const p of params) {
    if (p.defaultValue !== undefined) {
      scope.set(p.name, { value: p.defaultValue, origin: 'default', secret: false })
    }
  }
  for (const v of env?.values ?? []) {
    scope.set(v.name, { value: v.value, origin: 'environment', secret: v.secret })
  }
  for (const [name, value] of Object.entries(call)) {
    scope.set(name, { value, origin: 'call', secret: false })
  }
  return scope
}

/**
 * 없는 이름만 골라낸다. **빈 문자열 값은 "없음"이 아니다** —
 * 일부러 빈 값을 보내는 것과 값을 안 넣은 것은 다른 뜻이다.
 */
export function missingRefs(refs: readonly string[], scope: Scope): string[] {
  return refs.filter((r) => !scope.has(r))
}

export function resolveValue(name: string, scope: Scope): ResolvedValue | undefined {
  return scope.get(name)
}
