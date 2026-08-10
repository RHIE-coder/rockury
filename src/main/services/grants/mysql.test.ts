import type { Connection } from 'mysql2/promise'
import { describe, expect, it, vi } from 'vitest'
import { introspectMysqlGrants, parseShowGrants } from './mysql'

/**
 * CASE-remote-070 · 073 — MySQL 원시 → 권한 IR 정규화, 못 보는 계정.
 * introspection/mysql.test.ts 의 가짜 연결 라우터 패턴을 따른다.
 */

describe('parseShowGrants (CASE-remote-070)', () => {
  it('전역/DB/테이블 층을 대상 표기로 가른다', () => {
    const g = parseShowGrants('app@%', [
      "GRANT SELECT ON *.* TO 'app'@'%'",
      'GRANT INSERT ON `shop`.* TO `app`@`%`',
      'GRANT UPDATE ON `shop`.`orders` TO `app`@`%`'
    ])
    expect(g).toEqual([
      { account: 'app@%', privilege: 'SELECT', layer: 'global' },
      { account: 'app@%', privilege: 'INSERT', layer: 'database', db: 'shop' },
      { account: 'app@%', privilege: 'UPDATE', layer: 'table', db: 'shop', table: 'orders' }
    ])
  })

  it('여러 권한을 쉼표로 갈라 각각 한 행으로 편다', () => {
    const g = parseShowGrants('a@h', ["GRANT SELECT, INSERT, DELETE ON `d`.`t` TO 'a'@'h'"])
    expect(g.map((x) => x.privilege)).toEqual(['SELECT', 'INSERT', 'DELETE'])
  })

  it('컬럼 권한 — 괄호 안 컬럼마다 column 층 한 행', () => {
    const g = parseShowGrants('a@h', ["GRANT SELECT (id, name), UPDATE (name) ON `d`.`t` TO 'a'@'h'"])
    expect(g).toEqual([
      { account: 'a@h', privilege: 'SELECT', layer: 'column', db: 'd', table: 't', column: 'id' },
      { account: 'a@h', privilege: 'SELECT', layer: 'column', db: 'd', table: 't', column: 'name' },
      { account: 'a@h', privilege: 'UPDATE', layer: 'column', db: 'd', table: 't', column: 'name' }
    ])
  })

  it('ALL PRIVILEGES 는 낱권한으로 전개된다', () => {
    const g = parseShowGrants('a@h', ["GRANT ALL PRIVILEGES ON `d`.* TO 'a'@'h'"])
    const privs = g.map((x) => x.privilege)
    expect(privs).toContain('SELECT')
    expect(privs).toContain('INSERT')
    expect(privs).toContain('UPDATE')
    expect(privs).toContain('DELETE')
    expect(privs).not.toContain('ALL PRIVILEGES')
    expect(new Set(g.map((x) => x.layer))).toEqual(new Set(['database']))
  })

  it('USAGE 만 있으면 권한 0행 — 하지만 파서가 터지지 않는다(계정은 목록 쪽이 지킨다)', () => {
    expect(parseShowGrants('a@h', ["GRANT USAGE ON *.* TO 'a'@'h'"])).toEqual([])
  })

  it('이름 안의 백틱(``)·점을 되돌린다', () => {
    const g = parseShowGrants('a@h', ['GRANT SELECT ON `we``ird`.`do.t` TO `a`@`h`'])
    expect([g[0].db, g[0].table]).toEqual(['we`ird', 'do.t'])
  })

  it('GRANT OPTION 꼬리·프록시/role 부여 줄은 권한 행을 만들지 않는다', () => {
    const g = parseShowGrants('a@h', [
      "GRANT SELECT ON `d`.* TO 'a'@'h' WITH GRANT OPTION",
      "GRANT `read_role`@`%` TO 'a'@'h'", // role 부여 — 대상이 객체가 아니라 계정
      "GRANT PROXY ON ''@'' TO 'a'@'h' WITH GRANT OPTION"
    ])
    expect(g).toEqual([{ account: 'a@h', privilege: 'SELECT', layer: 'database', db: 'd' }])
  })
})

describe('introspectMysqlGrants (CASE-remote-073)', () => {
  const routers = {
    /** 관리자 — 계정 카탈로그도 남의 SHOW GRANTS 도 보인다. */
    admin: (sql: string): unknown[] | Error => {
      if (sql.includes('CURRENT_USER')) return [{ me: 'root@%' }]
      if (sql.includes('mysql.user'))
        return [
          { user: 'root', host: '%' },
          { user: 'app', host: '%' }
        ]
      if (sql.startsWith('SHOW GRANTS FOR'))
        return sql.includes("'app'")
          ? [{ g: "GRANT SELECT ON `shop`.* TO 'app'@'%'" }]
          : [{ g: "GRANT ALL PRIVILEGES ON *.* TO 'root'@'%'" }]
      return []
    },
    /** 일반 — 카탈로그가 안 보인다(권한 오류). 자기 SHOW GRANTS 만 된다. */
    limitedError: (sql: string): unknown[] | Error => {
      if (sql.includes('CURRENT_USER')) return [{ me: 'app@%' }]
      if (sql.includes('mysql.user')) return new Error('SELECT command denied')
      if (sql === 'SHOW GRANTS') return [{ g: "GRANT SELECT ON `shop`.* TO 'app'@'%'" }]
      return []
    },
    /** 일반 — 카탈로그가 빈 결과(행 필터링). 두 실패 형태가 같은 답이어야 한다. */
    limitedEmpty: (sql: string): unknown[] | Error => {
      if (sql.includes('CURRENT_USER')) return [{ me: 'app@%' }]
      if (sql.includes('mysql.user')) return []
      if (sql === 'SHOW GRANTS') return [{ g: "GRANT SELECT ON `shop`.* TO 'app'@'%'" }]
      return []
    }
  }

  function fakeConn(answer: (sql: string) => unknown[] | Error): Connection {
    return {
      query: async (sql: string) => {
        const out = answer(sql)
        if (out instanceof Error) throw out
        return [out, []]
      }
    } as unknown as Connection
  }

  it('관리자: 전 계정 + 계정마다 권한, warnings 비어 있음', async () => {
    const ir = await introspectMysqlGrants(fakeConn(routers.admin), 'mysql')
    expect(ir.accounts.map((a) => a.account).sort()).toEqual(['app@%', 'root@%'])
    expect(ir.accounts.find((a) => a.account === 'root@%')?.isCurrent).toBe(true)
    expect(ir.grants.some((g) => g.account === 'app@%' && g.privilege === 'SELECT')).toBe(true)
    expect(ir.warnings).toEqual([])
  })

  it.each([
    ['권한 오류', 'limitedError'],
    ['빈 결과', 'limitedEmpty']
  ] as const)('일반(%s): 자기 계정만 + "못 본다" 경고 — 오류로 죽지 않는다', async (_label, key) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ir = await introspectMysqlGrants(fakeConn(routers[key]), 'mysql')
      expect(ir.accounts.map((a) => a.account)).toEqual(['app@%'])
      expect(ir.accounts[0].isCurrent).toBe(true)
      expect(ir.grants.some((g) => g.privilege === 'SELECT')).toBe(true)
      expect(ir.warnings.length).toBeGreaterThan(0)
    } finally {
      warn.mockRestore()
    }
  })
})
