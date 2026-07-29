import type { ServiceCoverage } from './types'

/**
 * 앱 셸(창 제어)의 MCP 노출 지도 — 어느 서비스에도 속하지 않는 공용 크롬이다.
 * 서비스 에이전트는 이 파일을 건드리지 않는다.
 */
export const shellCoverage: ServiceCoverage = {
  service: 'shell',
  tools: {},
  excluded: {
    // ── 창 제어: 원격 조작 대상 아님 ──
    'window:minimize': 'UI 창 제어 — 원격 노출 실익 없음',
    'window:toggle-maximize': 'UI 창 제어 — 원격 노출 실익 없음',
    'window:close': 'UI 창 제어 — 원격 노출 실익 없음',
    // ── 개발용 화면 피드백: 에이전트가 부를 것이 아니라 사람이 앱에서 남기는 입력 ──
    'shell:saveDevFeedback':
      '개발 전용 도구 — 사람이 화면에 표시를 그려 남기는 입력이라 원격 호출 대상이 아니다. ' +
      '에이전트는 결과물(.harness/feedback/<시각>-<화면>/)을 파일로 읽는다.'
  }
}
