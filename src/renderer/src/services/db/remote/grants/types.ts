/**
 * 권한(Grant) 렌더러 타입 — main IR 과 구조적으로 일치(JSON 페이로드라 중복 선언 허용,
 * preload 관례와 동일 — `remote/introspection.ts` 참조).
 */

export type GrantLayer = 'global' | 'database' | 'table' | 'column'

export interface RawGrant {
  account: string
  privilege: string
  layer: GrantLayer
  db?: string
  table?: string
  column?: string
  via?: 'PUBLIC'
  implicit?: boolean
}

export interface GrantAccount {
  account: string
  isCurrent: boolean
  memberOf?: string[]
}

export interface GrantsIR {
  dialect: 'mysql' | 'mariadb' | 'postgresql'
  accounts: GrantAccount[]
  grants: RawGrant[]
  warnings: string[]
  /** 권한을 못 읽은 계정 — "없음"과 "모름"을 가르는 근거(privileges AC-6 · diff AC-4). */
  unreadableAccounts?: string[]
}

/** 문장 계획 — main `grants/statements` 와 구조적으로 일치(JSON 페이로드 중복 선언 관례). */
export interface StatementPlan {
  statements: { sql: string; kind: 'grant' | 'revoke' }[]
  excluded: { reason: 'self-revoke' | 'upper-layer' | 'column-layer'; change: unknown }[]
}

// 세트 타입·공통분모는 shared 가 정본 — main 저장소·문장 생성기와 어긋나면 화면이 조용히 틀린다.
export { SET_PRIVILEGES } from '../../../../../../shared/db/grantSet'
export type { GrantSetItem, GrantSetRecord } from '../../../../../../shared/db/grantSet'

/** 권한의 출처 하나 — 층 + (컬럼·PUBLIC 경유·암묵) 부가 정보. */
export interface PrivSource {
  layer: GrantLayer
  column?: string
  via?: 'PUBLIC'
  implicit?: boolean
}
