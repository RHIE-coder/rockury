import { describe, expect, it } from 'vitest'
import { expandPattern } from './pattern'

/** CASE-remote-075 — 패턴 전개. */

const TABLES = [
  { db: 'shop', table: 'orders' },
  { db: 'shop', table: 'orders_archive' },
  { db: 'shop', table: 'customers' },
  { db: 'analytics', table: 'orders' }
]

describe('expandPattern', () => {
  it('`*` 접두 일치 — orders* 꼴', () => {
    expect(expandPattern('orders*', TABLES).map((t) => `${t.db}.${t.table}`)).toEqual([
      'shop.orders',
      'shop.orders_archive',
      'analytics.orders'
    ])
  })

  it('`*` 없는 항목은 정확 일치', () => {
    expect(expandPattern('orders', TABLES).map((t) => t.db)).toEqual(['shop', 'analytics'])
    expect(expandPattern('order', TABLES)).toEqual([])
  })

  it('`스키마.` 한정 — 그 스키마 안에서만 맞는다', () => {
    expect(expandPattern('shop.orders*', TABLES).map((t) => t.table)).toEqual(['orders', 'orders_archive'])
    expect(expandPattern('analytics.customers', TABLES)).toEqual([])
  })

  it('매칭 0개는 빈 배열로 남는다 — 조용히 사라지지 않는다(부르는 쪽이 "매칭 없음"을 보인다)', () => {
    expect(expandPattern('tmp_*', TABLES)).toEqual([])
  })

  it('정규식 특수문자가 든 테이블 이름에 오작동하지 않는다', () => {
    const weird = [{ db: 'd', table: 'a.b+c' }, { db: 'd', table: 'axbxc' }]
    expect(expandPattern('a.b+c', weird)).toEqual([]) // 첫 점이 스키마 경계 — 스키마 a 로 읽힌다
    expect(expandPattern('a*', weird).map((t) => t.table)).toEqual(['a.b+c', 'axbxc'])
    // 점이 든 테이블 이름은 스키마를 붙여 가리킨다 — 첫 점까지만 스키마라 나머지는 이름
    expect(expandPattern('d.a.b+c', weird).map((t) => t.table)).toEqual(['a.b+c'])
  })
})
