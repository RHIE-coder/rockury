/**
 * DB 방언(dialect) 정본 — 렌더러(카탈로그 UI)와 메인(MCP 입력 검증·사용자 선택 안내)이 같은 집합을 쓴다.
 * 프로세스별 사본을 두면 벤더 추가 시 에이전트 입력만 거부되는 드리프트가 생겨 공용으로 분리.
 *
 * 라벨·한 줄 소개까지 여기 두는 이유: MCP 가 "방언을 사용자에게 고르게 하라"고 안내할 때
 * 앱 화면(생성 모달)과 **똑같은 선택지 문구**를 보여야 하기 때문. UI 전용 값(배지 색)만 렌더러가 얹는다.
 */
export const DIALECT_IDS = ['postgresql', 'mysql', 'mariadb', 'sqlite'] as const
export type DialectId = (typeof DIALECT_IDS)[number]

export interface DialectMeta {
  id: DialectId
  label: string
  /** 생성 모달 카드·에이전트 선택 안내에 쓰는 한 줄 소개. */
  blurb: string
}

export const DIALECT_META: DialectMeta[] = [
  { id: 'postgresql', label: 'PostgreSQL 16', blurb: '표준 지향 · JSONB/배열 등 풍부한 타입' },
  { id: 'mysql', label: 'MySQL 8.0', blurb: '가장 널리 쓰이는 웹 백엔드 RDBMS' },
  { id: 'mariadb', label: 'MariaDB 11', blurb: 'MySQL 호환 오픈소스 포크' },
  { id: 'sqlite', label: 'SQLite 3', blurb: '파일 기반 임베디드 · 프로토타이핑' }
]
