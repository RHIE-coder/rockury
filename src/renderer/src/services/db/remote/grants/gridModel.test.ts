import { describe, expect, it } from 'vitest'
import type { EffectiveRow } from './effective'
import { diffGrants } from './diff'
import { buildGridModel } from './gridModel'

/**
 * 리뷰 H-5 회귀 — '일치' 필터가 대조 밖 표를 일치로 새게 하던 결함.
 * '일치' = **매칭했고 변경이 없는 표**. 대조 밖 표·모자람 전용 행도 필터를 탄다.
 */

const TABLES = [
  { db: 'shop', table: 'orders' },
  { db: 'shop', table: 'users' },
  { db: 'shop', table: 'api_keys' }
]
const row = (table: string, privs: EffectiveRow['privs']): EffectiveRow => ({ db: 'shop', table, privs })

// 세트는 orders·users 만 겨눈다(SELECT). orders 는 일치, users 는 모자람, api_keys 는 대조 밖.
const effective = [
  row('orders', { SELECT: [{ layer: 'table' }] }),
  row('api_keys', { SELECT: [{ layer: 'table' }], DELETE: [{ layer: 'table' }] })
]
const diff = diffGrants(
  [
    { pattern: 'orders', privileges: ['SELECT'] },
    { pattern: 'users', privileges: ['SELECT'] }
  ],
  TABLES,
  effective,
  'app@%'
)

describe('buildGridModel — 대조 모드 (H-5 회귀)', () => {
  it("'일치' 는 매칭했고 변경 없는 표만 — 대조 밖 표가 새지 않는다", () => {
    const m = buildGridModel(effective, diff, 'ALL', 'match')
    expect(m.rows.map((r) => r.table)).toEqual(['orders'])
  })

  it("'모자람' 은 모자람 전용 행(유효 권한 0)도 잡는다", () => {
    const m = buildGridModel(effective, diff, 'ALL', 'missing')
    expect(m.rows.map((r) => r.table)).toEqual(['users'])
    expect(m.rows[0].marks).toEqual({ SELECT: 'missing' })
  })

  it('전체는 대조 밖 표까지 다 보이되 status 로 갈린다', () => {
    const m = buildGridModel(effective, diff, 'ALL', 'ALL')
    expect(Object.fromEntries(m.rows.map((r) => [r.table, r.status]))).toEqual({
      orders: 'match',
      users: 'changed',
      api_keys: 'outside'
    })
  })

  it('칩 개수는 행 단위 — 칩의 숫자가 곧 그 필터를 눌렀을 때의 행 수다 (재채점 M-1)', () => {
    const m = buildGridModel(effective, diff, 'ALL', 'ALL')
    expect(m.diffCounts).toEqual({ ALL: 3, match: 1, missing: 1, excess: 0 })
    for (const f of ['ALL', 'match', 'missing', 'excess'] as const)
      expect(buildGridModel(effective, diff, 'ALL', f).rows.length).toBe(m.diffCounts![f])
  })
})

describe('buildGridModel — 층 모드·전역 그 외 요약 (H-9)', () => {
  const adminRows = [
    row('orders', {
      SELECT: [{ layer: 'global' }],
      TRIGGER: [{ layer: 'global' }],
      RELOAD: [{ layer: 'global' }]
    }),
    row('users', {
      SELECT: [{ layer: 'global' }],
      TRIGGER: [{ layer: 'global' }],
      RELOAD: [{ layer: 'global' }],
      TRUNCATE: [{ layer: 'table' }]
    })
  ]

  it('전역에서만 온 그 외 권한은 행에서 빠지고 요약 목록으로 나온다', () => {
    const m = buildGridModel(adminRows, null, 'ALL', 'ALL')
    expect(m.globalExtras).toEqual(['RELOAD', 'TRIGGER'])
    for (const r of m.rows) {
      expect(r.privs.TRIGGER).toBeUndefined()
      expect(r.privs.RELOAD).toBeUndefined()
    }
    // 테이블층 출처가 있는 그 외(TRUNCATE)는 행에 남는다 — 행마다 다른 정보라서
    expect(m.rows.find((r) => r.table === 'users')?.privs.TRUNCATE).toBeDefined()
  })

  it('층 필터 칩 개수는 행에 실제로 남은 출처만 센다', () => {
    const m = buildGridModel(adminRows, null, 'ALL', 'ALL')
    expect(m.layerCounts.global).toBe(2) // SELECT ×2 행 (요약으로 뺀 TRIGGER·RELOAD 는 안 센다)
    expect(m.layerCounts.table).toBe(1)
  })

  it('층 필터 — 그 층 출처가 있는 행만 남는다', () => {
    const m = buildGridModel(adminRows, null, 'table', 'ALL')
    expect(m.rows.map((r) => r.table)).toEqual(['users'])
  })

  it('CRUD 권한은 전역-전용이어도 행에 남는다 — 1급 열이 비면 표가 의미를 잃는다', () => {
    const m = buildGridModel(adminRows, null, 'ALL', 'ALL')
    expect(m.rows.find((r) => r.table === 'orders')?.privs.SELECT).toBeDefined()
    expect(m.globalExtras).not.toContain('SELECT')
  })
})
