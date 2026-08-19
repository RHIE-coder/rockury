/**
 * DB 벤더(방언) 카탈로그 — DB 서비스 전역 공용.
 *
 * 방언은 Design(설계)의 생성 시 결정되는 고정 속성이다(§IA — Design).
 * 설계 화면·DDL 은 이 방언의 네이티브 구문 그대로 저술/출력되고,
 * 벤더 이동은 명시적 "포팅"(새 Design 생성)으로만 이뤄진다.
 */
import { DIALECT_META, type DialectId } from '@shared/dialects'

export type { DialectId }

export interface DialectInfo {
  id: DialectId
  label: string
  /** 벤더 아이덴티티 컬러 — 벤더 마크(`DialectMark`)를 이 색으로 물들인다. */
  dot: string
  /** 생성 모달 카드 등에 쓰는 한 줄 소개. */
  blurb: string
}

/** 벤더 아이덴티티 컬러 — 화면 전용이라 공용 정본(@shared/dialects)에 두지 않는다. */
const DOT: Record<DialectId, string> = {
  postgresql: '#336791',
  mysql: '#e48f10',
  mariadb: '#b0745e',
  sqlite: '#58a7d4'
}

export const DIALECTS: DialectInfo[] = DIALECT_META.map((d) => ({ ...d, dot: DOT[d.id] }))

export function dialectInfo(id: DialectId): DialectInfo {
  return DIALECTS.find((d) => d.id === id) ?? DIALECTS[0]
}
