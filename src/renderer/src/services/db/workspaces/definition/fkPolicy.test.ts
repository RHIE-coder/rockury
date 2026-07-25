import { describe, expect, it } from 'vitest'
import { fkPolicyChips, fkRefText, fkTargetLabel, IMPLIED_FK_ACTION } from './fkPolicy'
import type { Constraint } from './types'

const fk = (patch: Partial<Constraint> = {}): Constraint => ({
  id: 'k:orders.fk_orders_user',
  kind: 'fk',
  name: 'fk_orders_user',
  columns: [{ columnId: 'c:orders.user_id' }],
  refTable: 'users',
  refColumns: ['id'],
  ...patch
})

describe('fkPolicyChips', () => {
  it('ON DELETE·ON UPDATE 를 항상 둘 다, 이 순서로 낸다', () => {
    const chips = fkPolicyChips(fk({ onDelete: 'RESTRICT', onUpdate: 'CASCADE' }))
    expect(chips.map((c) => c.label)).toEqual(['ON DELETE RESTRICT', 'ON UPDATE CASCADE'])
    expect(chips.every((c) => !c.implicit)).toBe(true)
  })

  it('값이 없으면 DB 기본값(NO ACTION)을 채우고 implicit 로 표시한다', () => {
    const chips = fkPolicyChips(fk({ onDelete: 'CASCADE' }))
    expect(chips[1].value).toBe(IMPLIED_FK_ACTION)
    expect(chips[1].label).toBe('ON UPDATE NO ACTION')
    expect(chips[1].implicit).toBe(true)
    expect(chips[1].hint).toContain('DB 기본값')
    // 명시된 쪽은 흐리게 처리하지 않는다.
    expect(chips[0].implicit).toBe(false)
  })

  it('실 DB 가 NO ACTION 을 실제로 돌려줘도 흐리게 본다(특별한 정책이 아니므로)', () => {
    const chips = fkPolicyChips(fk({ onDelete: 'NO ACTION', onUpdate: 'NO ACTION' }))
    expect(chips.every((c) => c.implicit)).toBe(true)
    // 다만 값이 명시된 경우는 "지정하지 않아" 문구를 붙이지 않는다.
    expect(chips[0].hint).not.toContain('지정하지 않아')
  })

  it('fk 가 아니면 칩이 없다', () => {
    expect(fkPolicyChips({ ...fk(), kind: 'pk' })).toEqual([])
  })
})

describe('fkTargetLabel', () => {
  it('단일 컬럼은 `테이블 (컬럼)`', () => {
    expect(fkTargetLabel(fk())).toBe('users (id)')
  })

  it('복합 키는 쉼표로 잇는다', () => {
    expect(fkTargetLabel(fk({ refTable: 'orders', refColumns: ['org_id', 'no'] }))).toBe(
      'orders (org_id, no)'
    )
  })

  it('참조 컬럼이 비면 물음표로 자리를 남긴다', () => {
    expect(fkTargetLabel(fk({ refColumns: [] }))).toBe('users (?)')
    expect(fkTargetLabel(fk({ refTable: undefined }))).toBe('? (id)')
  })
})

describe('fkRefText', () => {
  it('기본은 참조만', () => {
    expect(fkRefText(fk({ onDelete: 'CASCADE' }))).toBe('→ users (id)')
  })

  it('정책 포함이면 두 정책을 모두 잇는다', () => {
    expect(fkRefText(fk({ onDelete: 'CASCADE' }), true)).toBe(
      '→ users (id) · ON DELETE CASCADE · ON UPDATE NO ACTION'
    )
  })

  it('fk 가 아니거나 대상이 없으면 undefined', () => {
    expect(fkRefText({ ...fk(), kind: 'uk' })).toBeUndefined()
    expect(fkRefText(fk({ refTable: '' }))).toBeUndefined()
  })
})
