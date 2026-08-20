import { collectRefs } from './template'
import type { EnvValue, RequestDef } from './types'

/**
 * 환경 값 건강 판정.
 *
 * 두 가지를 가른다:
 *   · **고아** — 어느 요청도 안 쓰는 값. 지워도 되는지 사람이 판단할 수 있게 이름을 보인다.
 *   · **구멍** — 참조는 되는데 값이 비었다. 실행하면 조립 단계에서 막히는데(resolution AC-3),
 *     **막히기 전에 미리 알려 주는 것**이 이 판정의 값어치다.
 *
 * 둘 다 아닌 값은 목록에 안 나온다 — 정상인 것을 나열하면 목록이 시끄러워 아무도 안 읽는다.
 */

export interface EnvHealth {
  /** 어느 요청도 참조하지 않는 값 이름. */
  orphans: string[]
  /** 참조되는데 값이 빈 값 이름. */
  holes: string[]
}

/** 요청 하나가 템플릿으로 참조하는 이름 전부. 파라미터 기본값 안의 참조까지 훑는다. */
export function refsOfRequest(req: RequestDef): string[] {
  const texts: string[] = []
  for (const v of Object.values(req.request)) {
    if (typeof v === 'string') texts.push(v)
    // 쿼리·헤더는 이름→값 묶음이다. **값만** 훑는다 — 이름은 템플릿이 아니다.
    else if (v && typeof v === 'object') texts.push(...Object.values(v as Record<string, string>))
  }
  for (const p of req.params) if (p.defaultValue) texts.push(p.defaultValue)

  const out: string[] = []
  for (const t of texts) for (const n of collectRefs(t)) if (!out.includes(n)) out.push(n)
  return out
}

export function envHealth(requests: readonly RequestDef[], values: readonly EnvValue[]): EnvHealth {
  const referenced = new Set<string>()
  for (const r of requests) for (const n of refsOfRequest(r)) referenced.add(n)

  const orphans: string[] = []
  const holes: string[] = []
  for (const v of values) {
    if (!referenced.has(v.name)) orphans.push(v.name)
    else if (v.value === '') holes.push(v.name)
  }
  return { orphans, holes }
}
