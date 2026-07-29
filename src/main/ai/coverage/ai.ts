import type { ServiceCoverage } from './types'

/**
 * AI 서비스의 MCP 노출 지도.
 *
 * 이 서비스의 IPC 채널은 전부 여기에 **노출(도구 대응) 또는 제외(사유)** 로 등재돼야 한다 —
 * 빠지면 `npm test` 가 실패한다(AGENTS.md 절대 불변식 4, 스테일 방지 핀).
 * 다른 서비스 파일은 건드리지 않는다(병렬 개발 파일 소유권).
 */
export const aiCoverage: ServiceCoverage = {
  service: 'ai',
  tools: {},
  excluded: {
    // ── AI 화면(에이전트 연동) 내부 채널: 자기참조 — 에이전트가 원격으로 만질 대상이 아니라 사람이 앱에서 관리 ──
    'ai:status': 'AI 화면 내부 — 접속 키 포함 등록 명령을 다루므로 원격 노출 금지',
    'ai:rotateToken': 'AI 화면 내부 — 접속 키 재발급은 사람 확인 하에서만(원격 노출 시 자기 차단 루프 위험)',
    // 도구 목록은 MCP 프로토콜이 이미 `tools/list` 로 제공한다 — 같은 것을 도구로 또 여는 것은 중복이다.
    // 이 채널은 **사람이 앱 화면에서** 서비스별로 훑어보라고 있는 것이다.
    'ai:tools': 'MCP 프로토콜의 tools/list 와 중복 — 에이전트는 그쪽으로 읽는다. 이 채널은 사람용 화면 전용'
  }
}
