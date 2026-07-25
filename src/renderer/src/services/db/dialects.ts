/**
 * DB 벤더(방언) 카탈로그 — DB 서비스 전역 공용.
 *
 * 방언은 Design(설계)의 생성 시 결정되는 고정 속성이다(§IA — Design).
 * 설계 화면·DDL 은 이 방언의 네이티브 구문 그대로 저술/출력되고,
 * 벤더 이동은 명시적 "포팅"(새 Design 생성)으로만 이뤄진다.
 */
import type { DialectId } from '@shared/dialects'

export type { DialectId }

export interface DialectInfo {
  id: DialectId
  label: string
  /** 벤더 아이덴티티 컬러 — 배지 dot 에 쓰인다. */
  dot: string
  /** 생성 모달 카드 등에 쓰는 한 줄 소개. */
  blurb: string
}

export const DIALECTS: DialectInfo[] = [
  {
    id: 'postgresql',
    label: 'PostgreSQL 16',
    dot: '#336791',
    blurb: '표준 지향 · JSONB/배열 등 풍부한 타입'
  },
  { id: 'mysql', label: 'MySQL 8.0', dot: '#e48f10', blurb: '가장 널리 쓰이는 웹 백엔드 RDBMS' },
  { id: 'mariadb', label: 'MariaDB 11', dot: '#b0745e', blurb: 'MySQL 호환 오픈소스 포크' },
  { id: 'sqlite', label: 'SQLite 3', dot: '#58a7d4', blurb: '파일 기반 임베디드 · 프로토타이핑' }
]

export function dialectInfo(id: DialectId): DialectInfo {
  return DIALECTS.find((d) => d.id === id) ?? DIALECTS[0]
}
