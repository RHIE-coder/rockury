import type { Client } from 'pg'
import type { GrantAccount, GrantsIR, RawGrant } from './types'

/**
 * PostgreSQL 권한 읽기(§db-remote.grants.vendor) — pg_roles(누구나 읽힘) + 객체 ACL.
 * 층 매핑: 이 앱에서 MySQL database 와 PG schema 가 같은 자리이므로(§db-remote.scope.model)
 * `db` 필드에 스키마 이름을 담고 층은 table/column 을 그대로 쓴다. role 소속은 이름
 * 나열까지만 — 상속 권한 전개는 범위 밖(vendor AC-3a).
 */

/** aclitem 권한 문자 → 이름. 없는 코드는 조용히 버리지 않고 `?<코드>` 로 남긴다(숨기면 현황이 거짓). */
const ACL_CODE: Record<string, string> = {
  a: 'INSERT',
  r: 'SELECT',
  w: 'UPDATE',
  d: 'DELETE',
  D: 'TRUNCATE',
  x: 'REFERENCES',
  t: 'TRIGGER'
}

/** 소유자 기본권한 — ACL 이 NULL 이면 소유자가 전부 가진 상태다(CASE-remote-071). */
const OWNER_DEFAULT = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']

/**
 * `{grantee=코드들/grantor,…}` 텍스트를 RawGrant[] 로 편다(순수 함수).
 * grantee 가 비면 PUBLIC — 모든 계정에 미치므로 via 표식을 단다.
 */
export function parseRelAcl(
  schema: string,
  table: string,
  owner: string,
  aclText: string | null
): RawGrant[] {
  if (aclText == null) {
    return OWNER_DEFAULT.map((privilege) => ({
      account: owner,
      privilege,
      layer: 'table' as const,
      db: schema,
      table,
      implicit: true
    }))
  }

  const out: RawGrant[] = []
  const body = aclText.replace(/^\{|\}$/g, '')
  if (!body) return out
  // relacl::text 는 **배열 리터럴**이다 — 인용이 필요한 grantee 의 항목은 요소 전체가
  // `"..."` 로 싸이고 안의 따옴표는 `\"` 로 이스케이프된다(`{"\"we ird\"=r/o"}`).
  // 이 겹을 먼저 벗겨야 안쪽 aclitem 파서가 제 몫을 한다(리뷰 지적 — 안 벗기면
  // 인용 필요한 role 의 권한이 통째로 조용히 탈락했다).
  for (const item of splitArrayLiteral(body)) {
    const eq = quoteAwareIndexOf(item, '=')
    const slash = item.lastIndexOf('/')
    if (eq < 0 || slash < eq) continue
    const rawGrantee = item.slice(0, eq)
    const codes = item.slice(eq + 1, slash)
    const grantee = rawGrantee ? unquote(rawGrantee) : 'PUBLIC'
    for (const ch of codes) {
      if (ch === '*') continue // grant option 표식 — 권한 자체는 앞 글자가 이미 냈다
      out.push({
        account: grantee,
        privilege: ACL_CODE[ch] ?? `?${ch}`,
        layer: 'table',
        db: schema,
        table,
        ...(rawGrantee ? {} : { via: 'PUBLIC' as const })
      })
    }
  }
  return out
}

/** PostgreSQL 배열 리터럴 본문을 요소로 가른다 — 요소 단위 `"..."` 감쌈과 `\"`·`\\` 를 되돌린다. */
function splitArrayLiteral(body: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (inQuote) {
      if (ch === '\\') {
        cur += body[i + 1] ?? ''
        i += 1
      } else if (ch === '"') inQuote = false
      else cur += ch
      continue
    }
    if (ch === '"') inQuote = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function quoteAwareIndexOf(s: string, ch: string): number {
  let inQuote = false
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '"') inQuote = !inQuote
    else if (s[i] === ch && !inQuote) return i
  }
  return -1
}

const unquote = (s: string): string =>
  s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s

export async function introspectPgGrants(client: Client): Promise<GrantsIR> {
  const warnings: string[] = []
  const q = async <T>(sql: string): Promise<T[]> => (await client.query(sql)).rows as T[]

  const me = (await q<{ me: string }>('SELECT current_user AS me'))[0]?.me ?? ''

  // pg_roles 는 누구나 읽힌다(카탈로그 자체가 world-readable) — MySQL 과 달리 여긴 잘 안 가려진다.
  let roles: { name: string }[] = []
  try {
    roles = await q<{ name: string }>(
      `SELECT rolname AS name FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY rolname`
    )
  } catch (e) {
    console.warn('[grants] pg_roles 를 읽지 못했습니다 — 자기 계정만 보입니다.', e)
    warnings.push('계정 목록을 읽을 권한이 없습니다 — 현재 계정의 권한만 표시됩니다.')
  }

  // 소속 role — 이름 나열까지만(전개 없음).
  const memberOf = new Map<string, string[]>()
  try {
    const rows = await q<{ member: string; role: string }>(
      `SELECT m.rolname AS member, r.rolname AS role
       FROM pg_auth_members am
       JOIN pg_roles m ON m.oid = am.member
       JOIN pg_roles r ON r.oid = am.roleid
       ORDER BY m.rolname, r.rolname`
    )
    for (const r of rows) (memberOf.get(r.member) ?? memberOf.set(r.member, []).get(r.member)!).push(r.role)
  } catch (e) {
    console.warn('[grants] pg_auth_members 를 읽지 못했습니다 — 소속 표시가 빠집니다.', e)
    warnings.push('role 소속을 읽지 못했습니다 — 소속 표시가 빠집니다.')
  }

  const accounts: GrantAccount[] =
    roles.length > 0
      ? roles.map((r) => ({
          account: r.name,
          isCurrent: r.name === me,
          ...(memberOf.has(r.name) ? { memberOf: memberOf.get(r.name) } : {})
        }))
      : [{ account: me, isCurrent: true, ...(memberOf.has(me) ? { memberOf: memberOf.get(me) } : {}) }]

  // 테이블 ACL — relacl 텍스트를 통째로 받아 순수 함수로 편다.
  const grants: RawGrant[] = []
  const unreadable: string[] = []
  try {
    const rows = await q<{ schema: string; tbl: string; owner: string; acl: string | null }>(
      `SELECT n.nspname AS schema, c.relname AS tbl, pg_get_userbyid(c.relowner) AS owner,
              c.relacl::text AS acl
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r','p','v','m') AND NOT c.relispartition
         AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
       ORDER BY n.nspname, c.relname`
    )
    for (const r of rows) grants.push(...parseRelAcl(r.schema, r.tbl, r.owner, r.acl))
  } catch (e) {
    console.warn('[grants] 테이블 ACL 을 읽지 못했습니다.', e)
    warnings.push('테이블 권한을 읽지 못했습니다 — 표가 비어 보이는 것은 "없다"가 아닙니다.')
    // ACL 자체를 못 읽었으면 모든 계정이 "모름"이다 — 대조를 맞음으로 그리지 않게(diff AC-4).
    unreadable.push(...accounts.map((a) => a.account))
  }

  return {
    dialect: 'postgresql',
    accounts,
    grants,
    warnings,
    ...(unreadable.length > 0 ? { unreadableAccounts: unreadable } : {})
  }
}
