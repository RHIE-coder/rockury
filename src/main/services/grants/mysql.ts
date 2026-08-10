import type { Connection } from 'mysql2/promise'
import type { GrantAccount, GrantsIR, RawGrant } from './types'

/**
 * MySQL/MariaDB 권한 읽기(§db-remote.grants.vendor) — 정본은 `SHOW GRANTS` 원문이다.
 * information_schema 권한 뷰 대신 SHOW GRANTS 를 쓰는 이유: FK 사건(2026-08-07)에서
 * information_schema 가 계정 권한에 따라 뷰별로 조용히 가려지는 것을 실측했다 —
 * SHOW GRANTS 는 자기 것은 언제나 되고, 남의 것은 되거나 명시적 오류라 "조용한 거짓"이 없다.
 */

/** `ALL PRIVILEGES` 전개 대상 — 표·DB 층에서 뜻 있는 표준 목록(버전별 잔가지는 그 외로 흘러온다). */
const ALL_EXPANSION = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'CREATE VIEW',
  'SHOW VIEW',
  'TRIGGER'
]

/** 백틱 식별자 — 안쪽 백틱은 겹쳐 적힌다. */
const IDENT = '`(?:[^`]|``)*`'
/** `GRANT <권한들> ON <db>.<table> TO …` — role 부여(`GRANT r TO u`)는 ON 이 없어 여기 안 걸린다. */
const GRANT_LINE = new RegExp(
  `^GRANT\\s+(.+?)\\s+ON\\s+(\\*|${IDENT}|[^\\s.]+)\\.(\\*|${IDENT}|[^\\s.]+)\\s+TO\\s`,
  'i'
)

const unq = (raw: string): string =>
  raw.startsWith('`') ? raw.slice(1, -1).replace(/``/g, '`') : raw

/** 괄호(컬럼 목록) 안의 쉼표를 건너뛰며 권한 목록을 가른다. */
function splitPrivs(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * `SHOW GRANTS` 원문 한 벌 → RawGrant[] (순수 함수 — CASE-remote-070).
 * USAGE(무권한 표식)·PROXY·role 부여 줄은 권한 행을 만들지 않는다.
 */
export function parseShowGrants(account: string, lines: string[]): RawGrant[] {
  const out: RawGrant[] = []
  for (const line of lines) {
    const m = GRANT_LINE.exec(line.trim())
    if (!m) continue // role 부여(`GRANT r TO u`) 등 — 객체 권한이 아니다
    const [, rawPrivs, rawDb, rawTable] = m
    const db = rawDb === '*' ? undefined : unq(rawDb)
    const table = rawTable === '*' ? undefined : unq(rawTable)
    const layer = !db ? 'global' : !table ? 'database' : 'table'

    for (const item of splitPrivs(rawPrivs)) {
      const colMatch = /^(.+?)\s*\(([^)]*)\)$/.exec(item)
      const name = (colMatch ? colMatch[1] : item).trim().toUpperCase()
      if (name === 'USAGE' || name === 'PROXY') continue
      const privs = name === 'ALL' || name === 'ALL PRIVILEGES' ? ALL_EXPANSION : [name]

      if (colMatch) {
        // 컬럼 권한 — 컬럼마다 한 행(층 표시가 컬럼까지 내려간다)
        for (const col of colMatch[2].split(',').map((c) => unq(c.trim())).filter(Boolean))
          for (const privilege of privs) out.push({ account, privilege, layer: 'column', db, table, column: col })
      } else {
        for (const privilege of privs) out.push({ account, privilege, layer, db, table })
      }
    }
  }
  return out
}

const accountId = (user: string, host: string): string => `${user}@${host}`
/** `'u'@'h'` 인용 — SHOW GRANTS FOR 대상. 이름은 ? 자리에 못 넣는다(값이 아니라 이름). */
const quoteAccount = (user: string, host: string): string =>
  `'${user.replace(/'/g, "''")}'@'${host.replace(/'/g, "''")}'`

/** CASE-remote-073 — 계정 카탈로그가 가려진 계정에서도 자기 권한은 나온다. */
export async function introspectMysqlGrants(
  conn: Connection,
  dialect: 'mysql' | 'mariadb'
): Promise<GrantsIR> {
  const warnings: string[] = []
  const q = async <T>(sql: string): Promise<T[]> => {
    const [rows] = await conn.query(sql)
    return rows as T[]
  }

  const me = (await q<{ me: string }>('SELECT CURRENT_USER() AS me'))[0]?.me ?? ''

  // 계정 목록 — mysql.user 는 관리자급만 보인다. 실패의 두 형태(오류·빈 결과) 모두
  // "자기 계정만" + 경고로 같은 답을 준다(없다 ≠ 못 본다).
  let users: { user: string; host: string }[] = []
  try {
    users = await q<{ user: string; host: string }>(
      'SELECT user, host FROM mysql.user ORDER BY user, host'
    )
  } catch (e) {
    console.warn('[grants] mysql.user 를 읽지 못했습니다 — 자기 계정만 보입니다.', e)
  }
  if (users.length === 0) {
    warnings.push('계정 목록을 읽을 권한이 없습니다 — 현재 계정의 권한만 표시됩니다.')
  }

  const accounts: GrantAccount[] =
    users.length > 0
      ? users.map((u) => ({ account: accountId(u.user, u.host), isCurrent: accountId(u.user, u.host) === me }))
      : [{ account: me, isCurrent: true }]

  const grants: RawGrant[] = []
  const unreadableAccounts: string[] = []
  for (const acc of accounts) {
    try {
      const sql = acc.isCurrent
        ? 'SHOW GRANTS'
        : (() => {
            const at = acc.account.lastIndexOf('@')
            return `SHOW GRANTS FOR ${quoteAccount(acc.account.slice(0, at), acc.account.slice(at + 1))}`
          })()
      const rows = await q<Record<string, string>>(sql)
      grants.push(...parseShowGrants(acc.account, rows.map((r) => Object.values(r)[0] ?? '')))
    } catch (e) {
      // 계정 하나가 막혔다고 전체를 버리면 그게 "권한 없음"이라는 거짓이 된다 —
      // 그 계정을 못-읽음 목록에 올려 화면이 "없음"과 "모름"을 가르게 한다(privileges AC-6).
      unreadableAccounts.push(acc.account)
      console.warn(`[grants] SHOW GRANTS 실패, 건너뜁니다: ${acc.account}`, e)
    }
  }
  if (unreadableAccounts.length > 0)
    warnings.push(`권한을 못 읽은 계정 ${unreadableAccounts.length}개 — 없음이 아니라 모름입니다.`)

  return { dialect, accounts, grants, warnings, unreadableAccounts }
}
