import { describe, expect, it } from 'vitest'
import { buildStatements, type GrantChange } from './statements'

/**
 * CASE-remote-077 · 078 — GRANT/REVOKE 문장 생성과 자기 회수 차단.
 * 미리보기와 실행이 같은 함수를 쓰므로(apply AC-4) 이 테스트가 실행 문장도 고정한다.
 */

const missing = (over: Partial<GrantChange> = {}): GrantChange => ({
  account: 'app@%',
  db: 'shop',
  table: 'orders',
  privilege: 'SELECT',
  kind: 'missing',
  ...over
})
const excess = (over: Partial<GrantChange> = {}): GrantChange => ({
  account: 'app@%',
  db: 'shop',
  table: 'orders',
  privilege: 'DELETE',
  kind: 'excess',
  layer: 'table',
  ...over
})

describe('buildStatements (CASE-remote-077)', () => {
  it('MySQL: 모자람 → GRANT, 백틱 + 계정 인용', () => {
    const plan = buildStatements('mysql', [missing()], { includeRevoke: false, currentAccount: 'root@%' })
    expect(plan.statements).toEqual([
      { sql: "GRANT SELECT ON `shop`.`orders` TO 'app'@'%';", kind: 'grant' }
    ])
    expect(plan.excluded).toEqual([])
  })

  it('PostgreSQL: 큰따옴표 식별자 + role 이름', () => {
    const plan = buildStatements('postgresql', [missing({ account: 'app' })], {
      includeRevoke: false,
      currentAccount: 'postgres'
    })
    expect(plan.statements[0].sql).toBe('GRANT SELECT ON "shop"."orders" TO "app";')
  })

  it('넘침은 REVOKE 기본 제외 — 옵션을 켠 때만 나온다', () => {
    const changes = [missing(), excess()]
    const off = buildStatements('mysql', changes, { includeRevoke: false, currentAccount: 'root@%' })
    expect(off.statements.map((s) => s.kind)).toEqual(['grant'])

    const on = buildStatements('mysql', changes, { includeRevoke: true, currentAccount: 'root@%' })
    expect(on.statements.map((s) => s.kind)).toEqual(['grant', 'revoke'])
    expect(on.statements[1].sql).toBe("REVOKE DELETE ON `shop`.`orders` FROM 'app'@'%';")
  })

  it('위층(전역·DB)에서 온 넘침은 REVOKE 를 만들지 않고 사유를 남긴다 (diff AC-6)', () => {
    const plan = buildStatements('mysql', [excess({ layer: 'database' })], {
      includeRevoke: true,
      currentAccount: 'root@%'
    })
    expect(plan.statements).toEqual([])
    expect(plan.excluded).toEqual([
      { reason: 'upper-layer', change: excess({ layer: 'database' }) }
    ])
  })

  it('이름 안의 인용부호를 겹쳐 막는다', () => {
    const plan = buildStatements(
      'mysql',
      [missing({ db: 'we`ird', table: "o'r" , account: "a'b@%" })],
      { includeRevoke: false, currentAccount: 'root@%' }
    )
    expect(plan.statements[0].sql).toBe("GRANT SELECT ON `we``ird`.`o'r` TO 'a''b'@'%';")
  })

  it('역슬래시로 끝나는 계정 이름이 문자열을 탈출하지 못한다 (보안)', () => {
    const plan = buildStatements('mysql', [missing({ account: 'app\\@%' })], {
      includeRevoke: false,
      currentAccount: 'root@%'
    })
    expect(plan.statements[0].sql).toBe("GRANT SELECT ON `shop`.`orders` TO 'app\\\\'@'%';")
  })

  it('privilege 가 화이트리스트 밖이면 명시적 오류 — 임의 SQL 보간을 막는다 (보안 H-1)', () => {
    expect(() =>
      buildStatements('mysql', [missing({ privilege: "ALL PRIVILEGES ON *.* TO 'evil'@'%'; -- " })], {
        includeRevoke: false,
        currentAccount: 'root@%'
      })
    ).toThrow('허용되지 않은 권한 종류')
    expect(() =>
      buildStatements('mysql', [{ ...missing(), kind: 'drop' as never }], {
        includeRevoke: false,
        currentAccount: 'root@%'
      })
    ).toThrow('허용되지 않은 변경 종류')
  })

  it('컬럼 층 넘침은 REVOKE 를 만들지 않는다 — 컬럼 목록 없는 깨진 문장 방지 (품질 H-3)', () => {
    const change = excess({ layer: 'column' })
    const plan = buildStatements('mysql', [change], { includeRevoke: true, currentAccount: 'root@%' })
    expect(plan.statements).toEqual([])
    expect(plan.excluded).toEqual([{ reason: 'column-layer', change }])
  })

  it('빈 diff 는 빈 계획', () => {
    expect(buildStatements('mysql', [], { includeRevoke: true, currentAccount: 'x@%' })).toEqual({
      statements: [],
      excluded: []
    })
  })
})

describe('자기 회수 차단 (CASE-remote-078)', () => {
  it('접속 중 계정을 겨눈 REVOKE 는 옵션을 켜도 빠지고, 차단 사유가 남는다', () => {
    const change = excess({ account: 'app@%' })
    const plan = buildStatements('mysql', [change], { includeRevoke: true, currentAccount: 'app@%' })
    expect(plan.statements).toEqual([])
    expect(plan.excluded).toEqual([{ reason: 'self-revoke', change }])
  })

  it('자기 자신에게 GRANT 는 허용', () => {
    const plan = buildStatements('mysql', [missing({ account: 'app@%' })], {
      includeRevoke: false,
      currentAccount: 'app@%'
    })
    expect(plan.statements).toHaveLength(1)
  })

  it('MySQL 은 host 가 달라도 user 가 같으면 보수적으로 차단한다', () => {
    const change = excess({ account: 'app@10.0.0.5' })
    const plan = buildStatements('mysql', [change], { includeRevoke: true, currentAccount: 'app@%' })
    expect(plan.excluded[0]?.reason).toBe('self-revoke')
  })

  it('PG 는 role 이름으로 동일성 판정', () => {
    const change = excess({ account: 'app', layer: 'table' })
    const plan = buildStatements('postgresql', [change], { includeRevoke: true, currentAccount: 'app' })
    expect(plan.excluded[0]?.reason).toBe('self-revoke')
  })
})
