/**
 * DB 방언(dialect) id 정본 — 렌더러(카탈로그 UI)와 메인(MCP 입력 검증)이 같은 집합을 쓴다.
 * 프로세스별 사본을 두면 벤더 추가 시 에이전트 입력만 거부되는 드리프트가 생겨 공용으로 분리.
 */
export const DIALECT_IDS = ['postgresql', 'mysql', 'mariadb', 'sqlite'] as const
export type DialectId = (typeof DIALECT_IDS)[number]
