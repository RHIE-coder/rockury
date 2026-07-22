import type { ConstraintKind } from '../../workspaces/definition/types'

/**
 * 그리드 헤더 표시용 순수 유틸(§ops 향상 — Data #3).
 * 키 배지는 열쇠 이모지 등 애매한 기호를 쓰지 않고 PK/FK/UK/IDX/CHECK **텍스트**로만 표기(사용자 규칙).
 * 순수 함수 → 테스트 의무 대상.
 */

/** 배지 표시 순서(왼→오). pk 를 가장 앞에. */
const BADGE_ORDER: ConstraintKind[] = ['pk', 'fk', 'uk', 'idx', 'check']

export const KIND_LABEL: Record<ConstraintKind, string> = {
  pk: 'PK',
  fk: 'FK',
  uk: 'UK',
  idx: 'IDX',
  check: 'CHECK'
}

/** 컬럼이 참여하는 제약 종류 집합 → 고정 순서의 텍스트 배지 목록. */
export function badgeLabels(kinds: Set<ConstraintKind> | undefined): string[] {
  if (!kinds || kinds.size === 0) return []
  return BADGE_ORDER.filter((k) => kinds.has(k)).map((k) => KIND_LABEL[k])
}

/**
 * 컬럼 헤더에 보일 타입 라벨. 실 DB 네이티브 타입 문자열을 그대로 보이되 공백만 정리한다
 * (예: `character varying(255)` → `character varying(255)`, `INT ` → `int`).
 */
export function typeLabel(type: string): string {
  return type.trim().replace(/\s+/g, ' ').toLowerCase()
}
