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
  /**
   * 뷰(view/matview)면 true. 운영부는 introspection 이 판별해 채우고,
   * 설계부는 사람이 Definition 에서 선언한다(테이블 ↔ 뷰 전환).
   */
  isView?: boolean
  /**
   * 뷰 본문 SELECT — `CREATE VIEW … AS <viewSql>` 의 뒷부분. 뷰일 때만 의미가 있다.
   * 왜 본문을 그냥 문자열로 두나: 뷰는 조인·집계·윈도우까지 들어오는 임의 질의라
   * 컬럼·제약처럼 구조화해도 방언 차이를 못 흡수한다 — 설계 방언 SQL 을 그대로 보관한다.
   * (뷰의 `columns` 는 그 SELECT 가 내놓는 결과 컬럼을 사람이 적어 두는 것 — ERD·Data 표시용.)
   */
  viewSql?: string
}
