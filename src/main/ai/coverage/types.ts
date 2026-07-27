/**
 * 한 서비스의 "앱 능력(IPC 채널) ↔ MCP 도구" 대응.
 *
 * 서비스마다 파일 하나 — 새 채널을 만든 에이전트는 자기 서비스 파일만 고치면 되고,
 * 다른 서비스 에이전트와 같은 줄을 건드릴 일이 없다(병렬 개발 파일 소유권).
 */
export interface ServiceCoverage {
  /** `SERVICE_IDS` 중 하나, 또는 어느 서비스에도 안 속하는 셸 기능이면 `shell`. */
  service: string
  /** 도구명 → 그 도구가 덮는 IPC 채널. 키 집합의 합은 `tools.ts` 의 TOOL_NAMES 와 같아야 한다. */
  tools: Record<string, string[]>
  /** 의도적으로 노출하지 않는 채널 → 사유. "아직 결정 안 함"은 사유가 아니다. */
  excluded: Record<string, string>
}
