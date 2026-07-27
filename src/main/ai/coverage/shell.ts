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
    'window:close': 'UI 창 제어 — 원격 노출 실익 없음'
  }
}
