import { describe, expect, it } from 'vitest'
import type { SavedFilterRecord } from '@shared/db/savedFilter'
import { orphanedFilterIds, savedFilterStatus } from './savedFilter'

/**
 * CASE-remote-068 · 069 — 못 쓰게 된 저장 필터 판정과 표 삭제 정리(§db-remote.data.saved-filter AC-4/AC-5).
 */
const saved = (id: string, over: Partial<SavedFilterRecord> = {}): SavedFilterRecord => ({
  id,
  connectionId: 'c1',
  schema: 'public',
  table: 'users',
  name: '이름',
  filters: [{ column: 'email', op: 'LIKE', value: '%a%' }],
  createdAt: '',
  updatedAt: '',
  ...over
})

describe('savedFilterStatus — 지금 표에 적용할 수 있나', () => {
  it('쓰는 컬럼이 다 있으면 정상', () => {
    expect(savedFilterStatus(saved('s1'), ['id', 'email'])).toEqual({ ok: true })
  })

  it('없는 컬럼이 있으면 그 이름과 함께 막는다', () => {
    const s = saved('s1', {
      filters: [
        { column: 'email', op: '=', value: 'a' },
        { column: 'nickname', op: '=', value: 'b' }
      ]
    })
    expect(savedFilterStatus(s, ['id', 'email'])).toEqual({ ok: false, missing: ['nickname'] })
  })

  it('값이 필요 없는 연산자도 컬럼은 있어야 한다', () => {
    const s = saved('s1', { filters: [{ column: 'deleted_at', op: 'IS NULL', value: '' }] })
    expect(savedFilterStatus(s, ['id'])).toEqual({ ok: false, missing: ['deleted_at'] })
  })

  it('같은 컬럼이 여러 조건에 쓰여도 한 번만 알린다', () => {
    const s = saved('s1', {
      filters: [
        { column: 'age', op: '>', value: '1' },
        { column: 'age', op: '<', value: '9' }
      ]
    })
    expect(savedFilterStatus(s, ['id'])).toEqual({ ok: false, missing: ['age'] })
  })

  it('조건이 하나도 없으면 정상으로 친다', () => {
    expect(savedFilterStatus(saved('s1', { filters: [] }), [])).toEqual({ ok: true })
  })
})

describe('orphanedFilterIds — 표가 사라졌는지 물어볼 후보', () => {
  const live = [
    { schema: 'public', name: 'users' },
    { schema: 'public', name: 'orders' }
  ]

  it('목록에 있는 표는 후보가 아니고, 없는 표만 후보다', () => {
    const rows = [saved('keep', { table: 'users' }), saved('gone', { table: 'sessions' })]
    expect(orphanedFilterIds(rows, live)).toEqual(['gone'])
  })

  it('표 목록이 비면 전부 후보다 — 마지막 표를 지운 경우가 여기다', () => {
    // 회귀(2026-08-08 실측): 예전엔 여기서 손을 떼는 바람에, 그 접속의 표를 전부 지우면
    // 저장 필터가 영영 남았다. 최종 판정은 확인 질의(`tableGone`)가 하므로 여기서 겁내지 않는다.
    const rows = [saved('a'), saved('b', { table: 'sessions' })]
    expect(orphanedFilterIds(rows, [])).toEqual(['a', 'b'])
  })

  it('지금 안 보는 스키마의 것도 후보가 된다 — 지운다는 뜻은 아니다', () => {
    // 범위(scope)를 좁혔을 뿐이면 확인 질의가 성공해서 살아남는다. 여기서 미리 빼면
    // 정작 그 스키마의 표가 진짜 지워졌을 때 영영 정리가 안 된다.
    const rows = [saved('other', { schema: 'auth', table: 'tokens' })]
    expect(orphanedFilterIds(rows, live)).toEqual(['other'])
  })

  it('스키마가 비어 있는 저장 필터는 스키마 없는 표와 짝짓는다', () => {
    // 단일 스키마 연결은 양쪽이 다 비어 있다(§db/schemaRef — 빈 스키마는 같은 스키마).
    const rows = [saved('keep', { schema: '', table: 't' }), saved('gone', { schema: '', table: 'x' })]
    expect(orphanedFilterIds(rows, [{ schema: undefined, name: 't' }])).toEqual(['gone'])
  })

  it('저장된 것이 없으면 후보도 없다', () => {
    expect(orphanedFilterIds([], live)).toEqual([])
  })
})
