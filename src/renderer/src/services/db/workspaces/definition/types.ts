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
  /**
   * 참조 대상의 스키마. 비면 **이 제약이 걸린 테이블과 같은 스키마**다.
   * 이름만으로 참조를 찾으면 두 스키마에 같은 이름 테이블이 있을 때 조용히 엉뚱한 곳에 붙는다 —
   * 찾는 일은 직접 하지 말고 `db/schemaRef` 의 `resolveRef` 를 쓴다.
   */
  refSchema?: string
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
  /**
   * 소속 스키마. 값의 의미가 벤더마다 다르다 — PostgreSQL 은 schema(`public`·`auth`),
   * MySQL/MariaDB 는 database(교차 database 조인·FK 가 되므로 PostgreSQL 의 schema 와 **같은 자리**),
   * SQLite 는 `main`. 비면 그 연결·설계의 기본 스키마다(예전 데이터·단일 스키마 사용자).
   * 카탈로그(PostgreSQL 의 database)는 여기 없다 — 한 화면은 언제나 카탈로그 하나이고,
   * 그것은 연결의 속성이다(§db-remote.scope).
   */
  schema?: string
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
