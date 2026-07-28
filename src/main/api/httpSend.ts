import type { RunStatus } from '../../shared/api/types'

/**
 * 실제 전송 — `docs/spec/api-runner.md` § send.execute.
 *
 * Node 내장 `fetch` 만 쓴다(의존성 추가 없음 — 그건 `main` 몫).
 * 이 파일의 알맹이는 전송 자체가 아니라 **실패를 갈래로 나누는 것**이다.
 * "실패"로 뭉뚱그리면 "못 붙었다"와 "붙었는데 401 이다"가 같아 보여 원인을 한참 찾게 된다.
 */

export interface SendInput {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface SendResult {
  status: RunStatus
  httpStatus: number | null
  durationMs: number
  response: { status: number; headers: Record<string, string>; body: string; size: number } | null
  error: string | null
}

/** 응답 본문을 통째로 메모리에 들이지 않기 위한 상한. 넘으면 잘라서 표시한다. */
const MAX_BODY = 2 * 1024 * 1024

interface ErrorLike {
  name?: string
  message?: string
  cause?: { code?: string; message?: string }
}

/**
 * 실패를 갈래로 나눈다(순수 — 그래서 테스트가 된다).
 * `aborted` 는 사용자가 취소한 것인지 시간이 다 된 것인지를 호출부가 알려 준다 —
 * 둘 다 AbortError 로 오기 때문에 오류 객체만으로는 구분할 수 없다.
 */
export function classifyFailure(err: unknown, aborted: 'user' | 'timeout' | null = null): {
  status: RunStatus
  message: string
} {
  const e = (err ?? {}) as ErrorLike
  const code = e.cause?.code ?? ''
  const msg = e.message ?? String(err)

  if (e.name === 'AbortError' || code === 'ABORT_ERR') {
    return aborted === 'timeout'
      ? { status: 'timeout', message: '정해진 시간 안에 응답이 오지 않았습니다.' }
      : { status: 'cancelled', message: '사용자가 취소했습니다.' }
  }
  if (/^(CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_VERIFY_|ERR_TLS_)/.test(code)) {
    return { status: 'tls-error', message: `인증서를 믿을 수 없습니다 (${code}).` }
  }
  if (code === 'ETIMEDOUT' || /TIMEOUT/.test(code)) {
    return { status: 'timeout', message: `응답을 기다리다 시간이 지났습니다 (${code}).` }
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return { status: 'connect-failed', message: `서버에 붙지 못했습니다 (${code}).` }
  }
  // 코드가 없는 fetch 실패도 "붙지 못함"으로 본다 — 응답을 못 받았다는 점은 같다.
  return { status: 'connect-failed', message: msg || '요청을 보내지 못했습니다.' }
}

export async function sendHttp(input: SendInput): Promise<SendResult> {
  const started = Date.now()
  const controller = new AbortController()
  let abortedBy: 'user' | 'timeout' | null = null

  const timer = setTimeout(() => {
    abortedBy = 'timeout'
    controller.abort()
  }, input.timeoutMs ?? 30_000)

  const onUserAbort = (): void => {
    abortedBy = 'user'
    controller.abort()
  }
  input.signal?.addEventListener('abort', onUserAbort)

  try {
    const res = await fetch(input.url, {
      method: input.method || 'GET',
      headers: input.headers,
      // GET/HEAD 에 본문을 실으면 fetch 가 던진다 — 사용자가 실수로 남긴 본문 때문에
      // "왜 안 되지"로 헤매지 않게 조용히 뺀다.
      body: ['GET', 'HEAD'].includes((input.method || 'GET').toUpperCase()) || !input.body
        ? undefined
        : input.body,
      signal: controller.signal,
      redirect: 'follow'
    })

    const raw = await res.text()
    const body = raw.length > MAX_BODY ? raw.slice(0, MAX_BODY) : raw
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })

    return {
      // 붙어서 응답을 받은 것과 못 붙은 것은 다른 갈래다 — 4xx/5xx 는 '오류 응답'이지 실패가 아니다.
      status: res.ok ? 'ok' : 'http-error',
      httpStatus: res.status,
      durationMs: Date.now() - started,
      response: { status: res.status, headers, body, size: raw.length },
      error: null
    }
  } catch (err) {
    const { status, message } = classifyFailure(err, abortedBy)
    return { status, httpStatus: null, durationMs: Date.now() - started, response: null, error: message }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onUserAbort)
  }
}
