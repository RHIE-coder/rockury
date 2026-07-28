import { MASK } from './template'
import type { EnvValue } from './types'

/**
 * 아는 비밀을 글자 단위로 지운다 — `docs/spec/api-runner.md` § send.observe AC-3.
 *
 * 요청을 가려 저장해도 **응답이 그 값을 되돌려주면 그대로 남는다**(키를 에코하는 서버,
 * 디버그 엔드포인트, 오류 메시지에 실린 인증 헤더 …). 그래서 저장 직전에 한 번 더 훑는다.
 *
 * **한계를 분명히 한다:** 여기서 지울 수 있는 것은 *우리가 값을 아는* 비밀뿐이다. 서버가
 * 새로 발급한 토큰(로그인 응답의 access token 등)은 우리가 모르므로 못 지운다 — 그래서
 * MCP 에는 본문을 아예 주지 않고 모양까지만 준다(`api-mcp.md` § tools.read AC-3).
 */

/** 짧은 값은 지우지 않는다 — 'a' 같은 값을 지우면 본문이 걸레가 되고 읽을 수 없다. */
const MIN_SECRET_LEN = 4

export function secretValues(values: readonly EnvValue[]): string[] {
  return values
    .filter((v) => v.secret && v.value.length >= MIN_SECRET_LEN)
    .map((v) => v.value)
    // 긴 것부터 지운다 — 짧은 값이 긴 값의 일부일 때 앞에서 잘라 먹으면 긴 값이 안 지워진다.
    .sort((a, b) => b.length - a.length)
}

export function redactText(text: string, secrets: readonly string[]): string {
  let out = text
  for (const s of secrets) out = out.split(s).join(MASK)
  return out
}

export function redactHeaders(
  headers: Record<string, string>,
  secrets: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k] = redactText(v, secrets)
  return out
}
