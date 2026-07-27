import type { ServiceCoverage } from './types'

/**
 * Infra 서비스의 MCP 노출 지도 — **아직 채널이 없다.**
 *
 * 이 파일은 Infra 서비스 에이전트의 자리다. `src/main/ipc/infra/` 에 채널을 열면 여기에
 * **노출(도구 대응) 또는 제외(사유)** 로 등재해야 한다 — 안 하면 `npm test` 가 실패한다
 * (AGENTS.md 절대 불변식 4, 스테일 방지 핀). 다른 서비스 파일은 건드리지 않는다.
 */
export const infraCoverage: ServiceCoverage = {
  service: 'infra',
  tools: {},
  excluded: {}
}
