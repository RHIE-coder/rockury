import { MASK } from './template'
import type { EnvValue } from './types'

/**
 * 아는 비밀을 글자 단위로 지운다.
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

/**
 * 같은 비밀의 **다른 표기**들. 서버가 되돌려주는 것이 원문이 아닐 수 있다 —
 * 쿼리에 실었으면 URL 인코딩된 형태로 돌아오고, `{{base64(key)}}` 로 보냈으면 base64 로
 * 에코된다. 글자 그대로만 찾으면 그게 다 그대로 남는다(e2e 로 실측해 잡은 자리다).
 *
 * 되돌릴 수 있는 표기만 넣는다. 해시·서명(`md5`·`sha256`·`hmac`)은 값마다 알고리즘이 갈려
 * 여기서 못 만든다 — **그건 우리가 못 지운다**(`api-runner.md` § send.observe AC-3b 의 한계).
 */
function encodings(value: string): string[] {
  const out = [value]
  const add = (v: string): void => {
    if (v !== value && !out.includes(v)) out.push(v)
  }
  add(encodeURIComponent(value))
  add(value.toUpperCase())
  add(value.toLowerCase())
  try {
    // 브라우저·Node 양쪽에 있는 것만 쓴다(shared 는 두 프로세스가 함께 쓴다).
    add(btoa(unescape(encodeURIComponent(value))))
  } catch {
    // 인코딩 못 하는 값이면 그 표기는 없는 것으로 둔다 — 지어내지 않는다.
  }
  return out
}

export function secretValues(values: readonly EnvValue[]): string[] {
  return values
    .filter((v) => v.secret && v.value.length >= MIN_SECRET_LEN)
    .flatMap((v) => encodings(v.value))
    .filter((v) => v.length >= MIN_SECRET_LEN)
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
