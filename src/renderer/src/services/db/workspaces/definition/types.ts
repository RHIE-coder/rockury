/** Definition 워크스페이스 로컬 도메인 타입 (아직 실 DB 미연동 — 인메모리 목데이터). */

export type KeyType = 'pk' | 'fk' | 'uk' | 'idx'
export type ConstraintKind = 'pk' | 'uk' | 'fk' | 'check' | 'idx'
export type FkAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'NO ACTION'

export interface Column {
  id: string
  name: string
  type: string
  nullable: boolean
  defaultValue: string | null
  comment: string
  /** 운영 드리프트에서 흡수된 컬럼 표식(§ IA). */
  drift?: { version: string }
}

/** 제약에 참여하는 컬럼 참조 — 배열 인덱스가 곧 복합 키 순서(1-based 로 표시). */
export interface ConstraintColumnRef {
  columnId: string
  /** 인덱스 방향 (idx/uk 에서 의미). 기본 ASC. */
  direction?: 'ASC' | 'DESC'
}

/**
 * 구조화된 제약 — DDL 은 이 구조에서 생성된다(생 SQL 문자열 편집 없음).
 *  - pk/uk/idx : columns (순서 중요)
 *  - fk        : columns[i] ↔ refColumns[i] 1:1 매핑 + on delete/update 정책
 *  - check     : expression
 */
export interface Constraint {
  id: string
  kind: ConstraintKind
  name: string
  columns: ConstraintColumnRef[]
  // ── fk 전용 ──
  refTable?: string
  refColumns?: string[]
  onDelete?: FkAction
  onUpdate?: FkAction
  // ── check 전용 ──
  expression?: string
}

export interface TableDef {
  id: string
  /** 소속 Design id — 테이블은 항상 한 설계에 속한다(§IA Design). 방언도 설계가 소유. */
  designId: string
  name: string
  comment: string
  columns: Column[]
  constraints: Constraint[]
  /** 운영부 introspection 에서 뷰(view/matview)로 판별되면 true(설계부에선 미사용). */
  isView?: boolean
}
