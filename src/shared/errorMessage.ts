/**
 * 던져진 것(unknown)에서 **사람에게 보일 한 줄**을 뽑는다 — 절대 빈 문자열을 돌려주지 않는다.
 *
 * 왜 필요한가(2026-07-31 실측): mysql2 의 접속 거부 오류는 `message` 가 **빈 문자열**이고 사유가
 * `code`(ECONNREFUSED) 에만 담긴다. 그 빈 문자열이 봉투(main) → unwrap(preload) → 화면까지
 * 그대로 흘러가면 화면이 `error && (…)` 로 falsy 판정을 해 **오류를 아예 안 그린다** —
 * 운영 DB 가져오기 다이얼로그가 미리보기도 오류도 스피너도 없는 막힌 화면이 됐다.
 * 그래서 "빈 메시지"를 오류의 정상 모양으로 보고 여기서 한 번에 메운다.
 */
export function errorMessage(err: unknown, fallback = '알 수 없는 오류가 발생했습니다.'): string {
  if (err instanceof Error) {
    const msg = err.message.trim()
    if (msg) return msg

    // message 가 빈 드라이버·소켓 오류 — code 와 붙은 주소로 사유를 복원한다.
    const e = err as { code?: unknown; address?: unknown; port?: unknown }
    const code = typeof e.code === 'string' && e.code.trim() ? e.code.trim() : ''
    const host = typeof e.address === 'string' && e.address.trim() ? e.address.trim() : ''
    const port = typeof e.port === 'number' ? String(e.port) : ''
    const where = host && port ? `${host}:${port}` : host || port
    if (code) return where ? `${code} (${where})` : code
    if (err.name && err.name !== 'Error') return err.name
    return fallback
  }

  if (typeof err === 'string') return err.trim() || fallback
  if (err === null || err === undefined) return fallback

  const s = String(err).trim()
  return s && s !== '[object Object]' ? s : fallback
}
