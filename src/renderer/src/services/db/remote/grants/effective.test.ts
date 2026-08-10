import { describe, expect, it } from 'vitest'
import { composeEffective } from './effective'
import type { RawGrant } from './types'

/**
 * CASE-remote-072 — 층 합성(유효 권한). 전역/DB/테이블 층이 한 객체의 유효 권한으로
 * 합쳐지고 권한마다 출처 층이 남는다.
 */

const TABLES = [
  { db: 'shop', table: 'orders' },
  { db: 'shop', table: 'customers' },
  { db: 'analytics', table: 'daily' }
]

const g = (over: Partial<RawGrant>): RawGrant => ({
  account: 'app@%',
  privilege: 'SELECT',
  layer: 'table',
  ...over
})

describe('composeEffective', () => {
  it('전역 층 권한은 모든 표에 내려온다', () => {
    const rows = composeEffective('app@%', [g({ layer: 'global' })], TABLES)
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.privs.SELECT?.map((s) => s.layer)).toEqual(['global'])
  })

  it('DB 층 권한은 그 DB 의 표에만 내려온다', () => {
    const rows = composeEffective('app@%', [g({ layer: 'database', db: 'shop' })], TABLES)
    expect(rows.filter((r) => r.privs.SELECT).map((r) => r.table).sort()).toEqual(['customers', 'orders'])
  })

  it('같은 권한이 여러 층에서 오면 출처를 전부 보존한다 — 넓은 층부터', () => {
    const rows = composeEffective(
      'app@%',
      [g({ layer: 'table', db: 'shop', table: 'orders' }), g({ layer: 'global' }), g({ layer: 'database', db: 'shop' })],
      TABLES
    )
    const orders = rows.find((r) => r.table === 'orders')!
    expect(orders.privs.SELECT.map((s) => s.layer)).toEqual(['global', 'database', 'table'])
  })

  it('아무 층에도 없으면 유효 권한에도 없다', () => {
    const rows = composeEffective('app@%', [g({ layer: 'database', db: 'shop', privilege: 'INSERT' })], TABLES)
    expect(rows.find((r) => r.table === 'orders')!.privs.SELECT).toBeUndefined()
  })

  it('다른 계정의 권한은 섞이지 않는다 — PUBLIC 은 예외로 모든 계정에 미친다(via 보존)', () => {
    const rows = composeEffective(
      'app@%',
      [
        g({ account: 'other@%', layer: 'global' }),
        g({ account: 'PUBLIC', via: 'PUBLIC', layer: 'table', db: 'shop', table: 'orders' })
      ],
      TABLES
    )
    const orders = rows.find((r) => r.table === 'orders')!
    expect(orders.privs.SELECT).toEqual([{ layer: 'table', via: 'PUBLIC' }])
    // customers 는 권한이 하나도 없다 — 빈 행은 표에 안 그린다(privileges AC-1)
    expect(rows.find((r) => r.table === 'customers')).toBeUndefined()
  })

  it('표 목록에 없는 객체를 겨눈 권한도 행으로 남는다 — 지워진 표의 잔류 권한이 안 사라진다', () => {
    const rows = composeEffective('app@%', [g({ db: 'shop', table: 'legacy' })], TABLES)
    expect(rows.find((r) => r.table === 'legacy')?.privs.SELECT).toBeDefined()
  })

  it('범위 밖 DB층 권한은 `db.*` 의사 행으로 남는다 — 증발하면 현황이 거짓 (vendor AC-6)', () => {
    const rows = composeEffective('app@%', [g({ layer: 'database', db: 'secret' })], TABLES)
    const pseudo = rows.find((r) => r.db === 'secret')!
    expect([pseudo.table, pseudo.privs.SELECT[0].layer]).toEqual(['*', 'database'])
  })

  it('표가 하나도 없으면 전역 권한은 `*.*` 의사 행이 대표한다', () => {
    const rows = composeEffective('app@%', [g({ layer: 'global' })], [])
    expect(rows).toHaveLength(1)
    expect([rows[0].db, rows[0].table]).toEqual(['*', '*'])
  })

  it('잔류 행(표 목록 밖)에도 전역·DB층이 내려온다 — 층 처리가 단계식이라 순서 무관', () => {
    const rows = composeEffective(
      'app@%',
      [
        g({ layer: 'global' }), // 잔류 행보다 먼저 온 전역
        g({ layer: 'table', db: 'shop', table: 'legacy', privilege: 'INSERT' })
      ],
      TABLES
    )
    const legacy = rows.find((r) => r.table === 'legacy')!
    expect(legacy.privs.SELECT?.map((s) => s.layer)).toEqual(['global'])
  })

  it('컬럼 권한은 그 표에 column 층 + 컬럼 이름으로 남는다', () => {
    const rows = composeEffective(
      'app@%',
      [g({ layer: 'column', db: 'shop', table: 'orders', column: 'total' })],
      TABLES
    )
    expect(rows.find((r) => r.table === 'orders')!.privs.SELECT).toEqual([
      { layer: 'column', column: 'total' }
    ])
  })
})
