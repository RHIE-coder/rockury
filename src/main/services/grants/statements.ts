import { SET_PRIVILEGES } from '../../../shared/db/grantSet'
import type { GrantLayer } from './types'

/**
 * GRANT/REVOKE 문장 생성(§db-remote.grants.apply) — **순수 함수 한 곳**.
 * 미리보기(grants:plan)와 실행(grants:apply)이 같은 diff 입력으로 이 함수를 다시 불러
 * 같은 문장을 얻는다 — 두 벌로 만들면 언젠가 어긋난다(AC-4).
 *
 * 여기가 main 의 방어선이다: changes 는 렌더러가 보낸 값이라 믿지 않는다(보안 감사 H-1).
 * privilege 는 화이트리스트 정확 일치만 — 이 문자열은 인용 없이 문장에 박히므로,
 * 검증을 빼면 IPC·오염된 세트가 임의 SQL 실행 프리미티브가 된다.
 */

export interface GrantChange {
  account: string
  db: string
  table: string
  privilege: string
  kind: 'missing' | 'excess'
  /** excess 전용 — 이 권한이 온 층. 테이블 층이 아니면 REVOKE 로 걷지 않는다(diff AC-6). */
  layer?: GrantLayer
}

export interface StatementPlan {
  statements: { sql: string; kind: 'grant' | 'revoke' }[]
  /** 말없이 빼지 않는다(AC-3a) — 빠진 문장은 사유와 함께 남긴다. */
  excluded: { reason: 'self-revoke' | 'upper-layer' | 'column-layer'; change: GrantChange }[]
}

type Dialect = 'mysql' | 'mariadb' | 'postgresql'

const ALLOWED_PRIV = new Set<string>(SET_PRIVILEGES)
const ALLOWED_KIND = new Set(['missing', 'excess'])

/** 렌더러발 change 를 검증한다 — 위반은 조용한 제외가 아니라 **오류**다(정상 화면은 못 만드는 값). */
function assertSafe(c: GrantChange): void {
  if (!ALLOWED_PRIV.has(c.privilege)) throw new Error(`허용되지 않은 권한 종류: ${c.privilege}`)
  if (!ALLOWED_KIND.has(c.kind)) throw new Error(`허용되지 않은 변경 종류: ${c.kind}`)
  for (const [field, v] of [['db', c.db], ['table', c.table], ['account', c.account]] as const) {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`비어 있는 대상: ${field}`)
  }
}

const qMy = (name: string): string => `\`${name.replace(/`/g, '``')}\``
const qPg = (name: string): string => `"${name.replace(/"/g, '""')}"`
/** MySQL 문자열 리터럴 — 역슬래시가 이스케이프 문자다(기본 sql_mode). `\` 를 안 막으면
 *  값 끝의 `\` 가 닫는 따옴표를 잡아먹어 문자열이 탈출한다(보안 감사). */
const qMyStr = (v: string): string => v.replace(/\\/g, '\\\\').replace(/'/g, "''")

/** MySQL 계정 `u@h` → `'u'@'h'` (마지막 @ 가 경계 — user 에 @ 가 들어갈 수 있다). */
function splitAccount(account: string): { user: string; host: string } {
  const at = account.lastIndexOf('@')
  return at < 0 ? { user: account, host: '%' } : { user: account.slice(0, at), host: account.slice(at + 1) }
}
const myAccount = (account: string): string => {
  const { user, host } = splitAccount(account)
  return `'${qMyStr(user)}'@'${qMyStr(host)}'`
}

export function buildStatements(
  dialect: Dialect,
  changes: GrantChange[],
  opts: { includeRevoke: boolean; currentAccount: string }
): StatementPlan {
  const my = dialect !== 'postgresql'
  const obj = (c: GrantChange): string => (my ? `${qMy(c.db)}.${qMy(c.table)}` : `${qPg(c.db)}.${qPg(c.table)}`)
  const who = (c: GrantChange): string => (my ? myAccount(c.account) : qPg(c.account))
  /**
   * 자기 회수 판정 — PG 는 role 이름, MySQL 은 host 표기가 어긋날 수 있어(프록시·와일드카드)
   * user 부분 일치까지 보수적으로 차단한다. 더 막는 쪽이 안전하고, 빠진 문장은 사유가 남는다.
   */
  const isSelf = (account: string): boolean => {
    if (account === opts.currentAccount) return true
    return my && splitAccount(account).user === splitAccount(opts.currentAccount).user
  }

  const statements: StatementPlan['statements'] = []
  const excluded: StatementPlan['excluded'] = []

  for (const c of changes) {
    assertSafe(c)
    if (c.kind === 'missing') {
      statements.push({ sql: `GRANT ${c.privilege} ON ${obj(c)} TO ${who(c)};`, kind: 'grant' })
      continue
    }
    // 넘침 — REVOKE 는 기본 꺼짐(AC-2), 켜져도 세 관문을 거친다.
    if (!opts.includeRevoke) continue
    if (c.layer === 'column') {
      // 컬럼 단위 REVOKE 는 컬럼 목록이 필요한데 change 에 없다 — 깨진 문장을 만드느니 뺀다(품질 H-3).
      excluded.push({ reason: 'column-layer', change: c })
      continue
    }
    if (c.layer && c.layer !== 'table') {
      excluded.push({ reason: 'upper-layer', change: c }) // 테이블 문장으로 안 걷힌다(diff AC-6)
      continue
    }
    if (isSelf(c.account)) {
      excluded.push({ reason: 'self-revoke', change: c }) // 앱이 스스로 접속을 끊는 사고 방지(AC-3)
      continue
    }
    statements.push({ sql: `REVOKE ${c.privilege} ON ${obj(c)} FROM ${who(c)};`, kind: 'revoke' })
  }

  return { statements, excluded }
}
