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

/** 배지 색 갈래 — `pk`·`fk` 는 저마다, 나머지는 한 색. */
export type BadgeTone = 'pk' | 'fk' | 'other'

/**
 * 배지 하나가 어떤 색으로 서야 하는지.
 *
 * 예전엔 PK·FK·UK·IDX 가 **전부 같은 색**이라 "키가 걸려 있다"만 보이고 어느 쪽인지는
 * 글자를 읽어야 알았다(2026-09-02 요청). 가장 자주 찾는 둘(PK·FK)만 색을 가른다 —
 * 다섯을 다 다른 색으로 두면 표가 색깔 잔치가 되어 오히려 아무것도 안 도드라진다.
 */
export function badgeTone(label: string): BadgeTone {
  if (label === KIND_LABEL.pk) return 'pk'
  if (label === KIND_LABEL.fk) return 'fk'
  return 'other'
}

/**
 * 갈래별 화면 클래스 — **여기 한 곳**에 둔다. Data 그리드와 Query 의 Schema 패널이
 * 같은 배지를 그리는데, 각자 적어 두면 한쪽만 고쳐져 색이 갈린다.
 * PK 는 테라코타(accent-2), FK 는 파랑(info) — 참조는 링크처럼 읽히는 색이 맞다.
 */
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  pk: 'bg-accent-2-soft text-accent-2',
  fk: 'bg-info-soft text-info',
  other: 'bg-accent-soft text-accent'
}

/** 그 컬럼 **머리 칸**의 바탕 — 배지와 같은 갈래로 물들여 열 전체를 가른다. */
export const HEAD_TONE_CLASS: Record<BadgeTone, string> = {
  pk: 'bg-accent-2-soft',
  fk: 'bg-info-soft',
  other: 'bg-panel'
}
