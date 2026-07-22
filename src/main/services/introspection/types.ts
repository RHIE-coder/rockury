/**
 * Introspection IR — 벤더 중립 역설계 결과(§ops-plan Phase 2a).
 * main 어댑터(mysql/pg/sqlite)가 이 형태로 생산하고, IPC 로 렌더러에 넘긴 뒤
 * 렌더러 `console/introspection.normalizeSchema` 가 TableDef 로 접는다.
 * (렌더러의 동일 형태와 구조적으로 일치 — JSON 페이로드라 중복 선언 허용, preload 관례와 동일.)
 */
export type IntroDbType = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite'
export type FkAction = 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'NO ACTION'

export interface RawTable {
  name: string
  comment: string
  /** 뷰(view/matview)면 true. 일반 테이블은 false/undefined. */
  isView?: boolean
}

export interface RawColumn {
  table: string
  name: string
  type: string
  nullable: boolean
  default: string | null
  comment: string
  ordinal: number
}

export interface RawKey {
  table: string
  name: string
  kind: 'pk' | 'uk' | 'idx'
  column: string
  ordinal: number
  direction: 'ASC' | 'DESC'
}

export interface RawForeignKey {
  table: string
  name: string
  column: string
  refTable: string
  refColumn: string
  ordinal: number
  onDelete: FkAction
  onUpdate: FkAction
}

export interface IntrospectedSchema {
  dialect: IntroDbType
  tables: RawTable[]
  columns: RawColumn[]
  keys: RawKey[]
  foreignKeys: RawForeignKey[]
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
