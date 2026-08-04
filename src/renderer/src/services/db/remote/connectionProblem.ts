/**
 * 실 DB 접속 실패를 **사람 말로** 옮긴다.
 *
 * 드라이버가 주는 문구는 `connect ECONNREFUSED 127.0.0.1:5432` 처럼 개발자용이라, 그대로
 * 화면에 올리면 "무엇이 잘못됐고 내가 뭘 해야 하나"에 답하지 못한다. 실제로 그 화면을 보고
 * 앱이 고장 난 줄 안 사용자가 있었다(2026-08-04).
 *
 * **모르는 오류는 지어내지 않는다** — 원문을 그대로 남기고 원인 자리는 비운다.
 * 짐작한 원인을 적으면 엉뚱한 데를 고치게 만든다.
 */
export interface ConnectionProblem {
  /** 무엇이 잘못됐나 — 한 줄. */
  reason: string
  /** 무엇을 확인하면 되나. 모르면 null. */
  hint: string | null
  /** 드라이버 원문. 접어 두되 버리지 않는다(진짜 원인이 여기에만 있을 때가 있다). */
  raw: string
}

/** 오류 문구 조각 → (원인, 확인할 것). 위에서부터 먼저 맞는 것을 쓴다. */
const RULES: { match: RegExp; reason: string; hint: string }[] = [
  {
    // 서버까지는 닿았는데 그 포트에서 아무도 안 듣는다 — 서버가 꺼져 있거나 포트가 다르다.
    match: /ECONNREFUSED/i,
    reason: '서버가 연결을 거부했습니다',
    hint: '서버가 켜져 있는지, 주소와 포트가 맞는지 확인하세요.'
  },
  {
    match: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i,
    reason: '서버 주소를 찾을 수 없습니다',
    hint: '주소에 오타가 없는지, 사내망·VPN 에 연결돼 있는지 확인하세요.'
  },
  {
    match: /ETIMEDOUT|timeout|timed out/i,
    reason: '서버가 응답하지 않습니다',
    hint: '방화벽이 막고 있거나 VPN 이 끊겼을 수 있습니다.'
  },
  {
    match: /password authentication failed|Access denied|authentication failed|auth/i,
    reason: '아이디 또는 비밀번호가 맞지 않습니다',
    hint: '연결 설정에서 사용자와 비밀번호를 다시 확인하세요.'
  },
  {
    match: /database .* does not exist|Unknown database|no such database/i,
    reason: '그 이름의 데이터베이스가 없습니다',
    hint: '연결 설정의 데이터베이스 이름을 확인하세요.'
  },
  {
    match: /permission denied|not permitted|insufficient privilege/i,
    reason: '이 계정에는 볼 권한이 없습니다',
    hint: '스키마를 읽을 권한이 있는 계정인지 확인하세요.'
  },
  {
    match: /SSL|TLS|self.signed|certificate/i,
    reason: '보안 연결(SSL)에서 막혔습니다',
    hint: '연결 설정의 SSL 사용 여부와 인증서 설정을 확인하세요.'
  },
  {
    match: /ECONNRESET|socket hang up/i,
    reason: '연결이 도중에 끊겼습니다',
    hint: '서버가 접속을 끊었거나 네트워크가 불안정할 수 있습니다.'
  },
  {
    // 파일 기반(SQLite) — 경로가 틀렸거나 파일이 없다.
    match: /ENOENT|unable to open database file/i,
    reason: '데이터베이스 파일을 열 수 없습니다',
    hint: '파일 경로가 맞는지, 읽을 권한이 있는지 확인하세요.'
  }
]

export function describeConnectionError(raw: string): ConnectionProblem {
  const text = (raw ?? '').trim()
  if (!text) return { reason: '연결하지 못했습니다', hint: null, raw: '' }

  for (const r of RULES) {
    if (r.match.test(text)) return { reason: r.reason, hint: r.hint, raw: text }
  }
  // 규칙에 없는 오류 — 원인을 지어내지 않고 원문만 보인다.
  return { reason: '연결하지 못했습니다', hint: null, raw: text }
}
