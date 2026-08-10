/**
 * 권한(Grant) IR — 벤더 중립 권한 현황(§db-remote.grants.vendor).
 * main 어댑터(mysql/pg)가 이 형태로 생산하고, IPC 로 렌더러에 넘긴 뒤
 * 렌더러 `remote/grants/*` 순수 함수(층 합성·대조)가 화면 모형으로 접는다.
 * (렌더러의 동일 형태와 구조적으로 일치 — JSON 페이로드라 중복 선언 허용, preload 관례와 동일.)
 */

/**
 * 권한 층 — 어디에 준 권한인가(전역>DB>테이블>컬럼). 위층 권한은 아래로 내려온다.
 * PostgreSQL 은 1차 범위가 테이블 ACL(+PUBLIC 경유)이라 table/column 층만 나온다 —
 * `db` 필드에는 스키마 이름을 담는다(이 앱에서 MySQL database 와 PG schema 가 같은 자리).
 */
export type GrantLayer = 'global' | 'database' | 'table' | 'column'

export interface RawGrant {
  /** 계정 정체성 — MySQL/MariaDB 는 `user@host`(host 가 다르면 다른 계정), PG 는 role 이름. */
  account: string
  /** 대문자 정규화된 권한 이름(SELECT·INSERT·…). USAGE 같은 무권한 표식은 여기 안 들어온다. */
  privilege: string
  layer: GrantLayer
  /** 층에 따라 채워진다 — global 이면 둘 다 없음, database 면 db 만, table/column 이면 둘 다. */
  db?: string
  table?: string
  column?: string
  /** 경유 — PG 의 PUBLIC 권한은 모든 계정에 미치므로 합성 때 이 표식으로 출처를 남긴다. */
  via?: 'PUBLIC'
  /** 명시 GRANT 가 아니라 규칙이 준 것(PG 소유자 기본권한) — 화면이 흐리게 가른다. */
  implicit?: boolean
}

export interface GrantAccount {
  account: string
  /** 연결이 지금 쓰는 계정 — 〔접속 중〕 배지·자기 회수 차단(apply AC-3)의 근거. */
  isCurrent: boolean
  /** PG 전용 — 소속 role 이름 나열까지만(상속 전개는 범위 밖, vendor AC-3a). */
  memberOf?: string[]
}

export interface GrantsIR {
  dialect: 'mysql' | 'mariadb' | 'postgresql'
  accounts: GrantAccount[]
  grants: RawGrant[]
  /** 못 읽은 것의 사유 — 빈 결과를 "없다"로 읽지 않기 위한 자리(introspection 과 같은 패턴). */
  warnings: string[]
  /**
   * 권한을 **못 읽은** 계정 — 화면이 "부여된 권한 없음"(사실)과 "모름"을 가르고,
   * 이 계정의 대조를 "맞음"으로 표시하지 않기 위한 자리(privileges AC-6 · diff AC-4).
   */
  unreadableAccounts?: string[]
}

