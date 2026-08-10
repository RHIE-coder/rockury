import type { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { introspectPgGrants, parseRelAcl } from './pg'

/**
 * CASE-remote-071 · 073 — PostgreSQL ACL → 권한 IR 정규화, 못 보는 계정.
 */

describe('parseRelAcl (CASE-remote-071)', () => {
  it('aclitem 문자 코드를 권한 이름으로 편다 (r=SELECT a=INSERT w=UPDATE d=DELETE)', () => {
    const g = parseRelAcl('public', 'orders', 'owner1', '{app=arwd/owner1}')
    expect(g.map((x) => [x.account, x.privilege])).toEqual([
      ['app', 'INSERT'],
      ['app', 'SELECT'],
      ['app', 'UPDATE'],
      ['app', 'DELETE']
    ])
    expect(g.every((x) => x.layer === 'table' && x.db === 'public' && x.table === 'orders')).toBe(true)
  })

  it('빈 grantee(=PUBLIC)는 PUBLIC 계정 + via 표식', () => {
    const [g] = parseRelAcl('public', 't', 'o', '{=r/o}')
    expect([g.account, g.via, g.privilege]).toEqual(['PUBLIC', 'PUBLIC', 'SELECT'])
  })

  it('ACL 이 NULL 인 표는 "권한 없음"이 아니라 소유자 기본권한(implicit)', () => {
    const g = parseRelAcl('public', 't', 'owner1', null)
    expect(g.length).toBeGreaterThan(0)
    expect(g.every((x) => x.account === 'owner1' && x.implicit === true)).toBe(true)
    expect(g.map((x) => x.privilege)).toContain('SELECT')
  })

  it('따옴표로 감싼 grantee("weird role")를 벗긴다', () => {
    const g = parseRelAcl('s', 't', 'o', '{"we ird"=r/o}')
    expect(g[0].account).toBe('we ird')
  })

  it('실물 배열 리터럴 — 요소 감쌈과 \\" 이스케이프를 벗긴다 (안 벗기면 권한이 통째로 탈락)', () => {
    // relacl::text 실물: {"\"we ird\"=r/o",app=a/o}
    const g = parseRelAcl('s', 't', 'o', '{"\\"we ird\\"=r/o",app=a/o}')
    expect(g.map((x) => [x.account, x.privilege])).toEqual([
      ['we ird', 'SELECT'],
      ['app', 'INSERT']
    ])
  })

  it('그 외 코드(D=TRUNCATE x=REFERENCES t=TRIGGER)도 이름으로 편다 — 숨기지 않는다', () => {
    const g = parseRelAcl('s', 't', 'o', '{app=Dxt/o}')
    expect(g.map((x) => x.privilege)).toEqual(['TRUNCATE', 'REFERENCES', 'TRIGGER'])
  })
})

describe('introspectPgGrants (CASE-remote-073)', () => {
  function fakeClient(answer: (sql: string) => unknown[] | Error): Client {
    return {
      query: async (sql: string) => {
        const out = answer(sql)
        if (out instanceof Error) throw out
        return { rows: out }
      }
    } as unknown as Client
  }

  const base = (sql: string): unknown[] | Error => {
    if (sql.includes('current_user')) return [{ me: 'app' }]
    if (sql.includes('pg_auth_members'))
      return [{ member: 'app', role: 'readers' }]
    if (sql.includes('pg_roles')) return [{ name: 'postgres' }, { name: 'app' }, { name: 'readers' }]
    if (sql.includes('relacl'))
      return [
        { schema: 'public', tbl: 'orders', owner: 'postgres', acl: '{postgres=arwdDxt/postgres,app=r/postgres}' },
        { schema: 'public', tbl: 'logs', owner: 'postgres', acl: null }
      ]
    return []
  }

  it('전 role + 테이블 ACL + 소속(memberOf 나열까지만)', async () => {
    const ir = await introspectPgGrants(fakeClient(base))
    expect(ir.accounts.map((a) => a.account)).toEqual(['postgres', 'app', 'readers'])
    expect(ir.accounts.find((a) => a.account === 'app')).toMatchObject({ isCurrent: true, memberOf: ['readers'] })
    expect(ir.grants.some((g) => g.account === 'app' && g.table === 'orders' && g.privilege === 'SELECT')).toBe(true)
    // NULL ACL → 소유자 기본권한
    expect(ir.grants.some((g) => g.table === 'logs' && g.account === 'postgres' && g.implicit)).toBe(true)
    expect(ir.warnings).toEqual([])
  })

  it('테이블 ACL 읽기가 막히면 오류로 죽지 않고 경고를 남긴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ir = await introspectPgGrants(
        fakeClient((sql) => (sql.includes('relacl') ? new Error('permission denied') : base(sql)))
      )
      expect(ir.accounts.length).toBeGreaterThan(0)
      expect(ir.warnings.length).toBeGreaterThan(0)
    } finally {
      warn.mockRestore()
    }
  })
})
