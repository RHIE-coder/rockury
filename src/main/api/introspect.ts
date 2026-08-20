import { classifyFailure } from './httpSend'
import { INTROSPECTION_QUERY, IntrospectionError, parseIntrospection } from '../../shared/api/graphql'
import type { ServerSchema, UnavailableReason } from '../../shared/api/drift'

/**
 * 서버에게 스키마를 물어본다
 *
 * 실패를 **갈래로 나누는 것**이 이 파일의 알맹이다. "완전 판정 못 했다"를 뭉뚱그리면
 * 사용자는 서버 설정을 봐야 할지, 권한을 봐야 할지, 주소를 봐야 할지 모른다.
 * 그리고 어떤 경우에도 **관측 판정으로 조용히 내려가지 않는다** — 사유를 달아 빈 결과를 준다.
 */

export type IntrospectOutcome =
  | { ok: true; schema: ServerSchema }
  | { ok: false; reason: UnavailableReason; message: string }

export async function introspectGraphql(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15_000
): Promise<IntrospectOutcome> {
  if (!url) {
    return { ok: false, reason: 'connect-failed', message: '환경에 서버 주소가 없습니다.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: 'no-permission',
        message: `스키마를 읽을 권한이 없습니다 (HTTP ${res.status}). 환경의 인증 값을 확인하세요.`
      }
    }

    const text = await res.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return {
        ok: false,
        reason: 'feature-off',
        message: 'introspection 응답이 JSON 이 아닙니다 — 이 주소가 GraphQL 엔드포인트가 맞는지 확인하세요.'
      }
    }

    // 많은 서버가 운영에서 introspection 을 꺼 둔다. 그때는 200 에 errors 가 실려 온다 —
    // 붙었지만 스키마를 안 준 것이므로 '연결 실패'가 아니라 '기능 꺼짐'이다.
    const errors = (payload as { errors?: { message?: string }[] }).errors
    if (Array.isArray(errors) && errors.length > 0) {
      return {
        ok: false,
        reason: 'feature-off',
        message: `서버가 스키마를 주지 않았습니다 — ${errors[0]?.message ?? '(사유 없음)'}`
      }
    }

    return { ok: true, schema: parseIntrospection(payload) }
  } catch (err) {
    if (err instanceof IntrospectionError) {
      return { ok: false, reason: 'feature-off', message: err.message }
    }
    const { message } = classifyFailure(err, null)
    return { ok: false, reason: 'connect-failed', message }
  } finally {
    clearTimeout(timer)
  }
}
