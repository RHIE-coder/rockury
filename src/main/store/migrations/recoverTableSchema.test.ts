import { describe, expect, it } from 'vitest'
import { schemaFromTableId } from './recoverTableSchema'

/**
 * 회귀(2026-08-03 실측): 저장이 `schema` 를 흘려 여러 스키마로 짜인 설계가 전부 한 스키마로
 * 뭉개졌다. id 는 멀쩡히 남아 있으므로 거기서 되찾는다 — 이 판정이 틀리면 없던 스키마를
 * 지어내거나(더 나쁨) 되살릴 수 있는 것을 놓친다.
 */
describe('schemaFromTableId', () => {
  it('역설계 id 에서 스키마를 되찾는다', () => {
    expect(schemaFromTableId('t:public.users')).toBe('public')
    expect(schemaFromTableId('t:entity.sessions')).toBe('entity')
  })

  it('설계 Draft 의 접두(`<설계>:`)가 붙어 있어도 되찾는다', () => {
    expect(schemaFromTableId('shop-orders:t:entity.users')).toBe('entity')
    // 설계 이름에 `t:` 를 닮은 조각이 있어도 마지막 `t:` 부터 읽어 흔들리지 않는다.
    expect(schemaFromTableId('cart:t:billing.invoices')).toBe('billing')
  })

  it('점이 없으면 원래 스키마가 없던 것 — 지어내지 않는다', () => {
    expect(schemaFromTableId('t:users')).toBeNull()
    expect(schemaFromTableId('design:t:users')).toBeNull()
  })

  it('스키마 이름이 비었거나 테이블 이름이 없으면 되찾을 게 없다', () => {
    expect(schemaFromTableId('t:.users')).toBeNull()
    expect(schemaFromTableId('t:public.')).toBeNull()
  })

  it('테이블 id 꼴이 아니면 건드리지 않는다', () => {
    expect(schemaFromTableId('c:public.users.id')).toBeNull()
    expect(schemaFromTableId('아무거나')).toBeNull()
  })

  it('테이블 이름에 점이 있어도 첫 점 앞이 스키마 — id 를 만들 때와 같은 규칙', () => {
    expect(schemaFromTableId('t:public.my.table')).toBe('public')
  })
})
