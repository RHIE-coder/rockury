/**
 * Introspection IR — 벤더 중립 역설계 결과(§ops-plan Phase 2a).
 * main 어댑터(mysql/pg/sqlite)가 이 형태로 생산하고, IPC 로 렌더러에 넘긴 뒤
 * 렌더러 `remote/introspection.normalizeSchema` 가 TableDef 로 접는다.
 * (렌더러의 동일 형태와 구조적으로 일치 — JSON 페이로드라 중복 선언 허용, preload 관례와 동일.)
 */
export type IntroDbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'
export type FkAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'NO ACTION'

export interface RawTable {
  /** 소속 스키마 — PostgreSQL 은 schema, MySQL 은 database, SQLite 는 `main`. */
  schema: string
  name: string
  comment: string
  /** 뷰(view/matview)면 true. 일반 테이블은 false/undefined. */
  isView?: boolean
}

export interface RawColumn {
  schema: string
  table: string
  name: string
  type: string
  nullable: boolean
  default: string | null
  comment: string
  ordinal: number
}

export interface RawKey {
  schema: string
  table: string
  name: string
  kind: 'pk' | 'uk' | 'idx'
  column: string
  ordinal: number
  direction: 'ASC' | 'DESC'
}

export interface RawForeignKey {
  schema: string
  table: string
  name: string
  column: string
  /** 참조 대상의 스키마 — 같은 스키마여도 채운다(비교하는 쪽이 추측하지 않게). */
  refSchema: string
  refTable: string
  refColumn: string
  ordinal: number
  onDelete: FkAction
  onUpdate: FkAction
}

/** CHECK 제약. 컬럼에 매이지 않고 식(expression) 하나가 본체다. */
export interface RawCheck {
  schema: string
  table: string
  name: string
  /** `CHECK (…)` 의 괄호 **안쪽**만. 바깥 `CHECK(...)` 는 DDL 생성기가 씌운다. */
  expression: string
}

export interface IntrospectedSchema {
  dialect: IntroDbType
  /** 이번에 읽은 스키마들. 화면이 "무엇을 보고 있나"를 알기 위한 것. */
  schemas: string[]
  tables: RawTable[]
  columns: RawColumn[]
  keys: RawKey[]
  foreignKeys: RawForeignKey[]
  checks: RawCheck[]
  /**
   * **결과가 불완전할 수 있는 사유.** 빈 목록이면 "다 읽었다"는 뜻이다.
   * 권한 때문에 못 읽은 것을 조용히 0으로 돌려주면 사용자는 있는 것을 없다고 믿는다 —
   * 그래서 못 읽은 사실 자체를 값으로 실어 화면까지 올린다.
   */
  warnings: string[]
}

/** 벤더 규칙 텍스트/코드를 FkAction 으로 정규화(모르면 NO ACTION). */
export function toFkAction(raw: string | null | undefined): FkAction {
  switch ((raw ?? '').toUpperCase()) {
    case 'CASCADE':
    case 'C':
      return 'CASCADE'
    case 'SET NULL':
    case 'N':
      return 'SET NULL'
    case 'SET DEFAULT':
    case 'D':
      return 'SET DEFAULT'
    case 'RESTRICT':
    case 'R':
      return 'RESTRICT'
    default:
      return 'NO ACTION'
  }
}
