import { describe, expect, it } from 'vitest'
import { planGate, removalSignature, removals } from './planGate'
import { diffSnapshots } from '../versions/diff'
import { columnId, tableId } from '../ids'
import type { TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'

const table = (name: string, cols: string[]): TableDef => ({
  id: tableId(undefined, name),
  designId: 'd1',
  name,
  comment: '',
  columns: cols.map((c) => ({
    id: columnId(undefined, name, c),
    name: c,
    type: 'int',
    nullable: true,
    defaultValue: null,
    comment: ''
  })) as TableDef['columns'],
  constraints: []
})

const snap = (tables: TableDef[]): VersionSnapshot => ({ tables })

/** 지금 DB(before) → 설계(after). 설계에 없는 것이 이 계획에서 사라진다. */
const plan = (before: TableDef[], after: TableDef[]) => diffSnapshots(snap(before), snap(after))

describe('removals — 이 계획이 실 DB 에서 없앨 것', () => {
  it('설계에 없는 테이블은 사라진다', () => {
    expect(removals(plan([table('orders', ['id']), table('probe', ['id'])], [table('orders', ['id'])]))).toEqual([
      'probe'
    ])
  })

  it('설계에 없는 컬럼도 센다 — 테이블째가 아니어도 데이터가 사라진다', () => {
    expect(removals(plan([table('orders', ['id', 'memo'])], [table('orders', ['id'])]))).toEqual(['orders.memo'])
  })

  it('더하기만 하는 계획은 없앨 것이 없다', () => {
    expect(removals(plan([table('orders', ['id'])], [table('orders', ['id', 'memo'])]))).toEqual([])
  })

  /*
   * 회귀(2026-08-14): 이름만 적던 시절, 스키마가 여럿인 DB 에서 `service1.members` 와
   * `service2.members` 가 둘 다 `members` 로 나왔다. 목록에서 어느 쪽인지 못 가르고,
   * 그 이름을 React key 로 쓰던 화면은 중복 키 오류를 뱉었다.
   */
  it('스키마가 다르면 같은 이름도 갈라 적는다', () => {
    const s1 = { ...table('members', ['id']), id: tableId('service1', 'members'), schema: 'service1' }
    const s2 = { ...table('members', ['id']), id: tableId('service2', 'members'), schema: 'service2' }

    const got = removals(plan([s1, s2], []))

    expect(got).toEqual(['service1.members', 'service2.members'])
    expect(new Set(got).size).toBe(got.length) // 겹치는 이름이 없다 = key 로 써도 된다
  })

  it('스키마가 없는 예전 데이터는 이름만 그대로 — 승인 표식이 안 바뀐다', () => {
    expect(removals(plan([table('probe', ['id'])], []))).toEqual(['probe'])
  })
})

describe('planGate — 없앨 것이 있으면 계획을 안 그린다', () => {
  it('계획이 없으면 통과다 — 아직 잴 것이 없는 상태까지 막으면 아무것도 못 한다', () => {
    expect(planGate(null, null)).toBe('ok')
  })

  it('더하기만 하면 통과한다', () => {
    expect(planGate(plan([table('orders', ['id'])], [table('orders', ['id', 'memo'])]), null)).toBe('ok')
  })

  it('없앨 것이 있으면 막는다', () => {
    expect(planGate(plan([table('orders', ['id', 'memo'])], [table('orders', ['id'])]), null)).toBe('removes')
  })

  it('진단을 거쳐 승인한 그 목록은 통과한다', () => {
    const d = plan([table('orders', ['id', 'memo'])], [table('orders', ['id'])])
    expect(planGate(d, removalSignature(d))).toBe('ok')
  })

  it('없앨 것이 달라지면 승인이 풀린다 — 승인은 그때 본 그 목록에 대한 것이다', () => {
    const before = plan([table('orders', ['id', 'memo'])], [table('orders', ['id'])])
    const after = plan([table('orders', ['id', 'note'])], [table('orders', ['id'])])
    expect(planGate(after, removalSignature(before))).toBe('removes')
  })

  it('개수가 같아도 이름이 다르면 다른 목록이다', () => {
    expect(removalSignature(plan([table('a', ['id']), table('x', ['id'])], [table('a', ['id'])]))).not.toBe(
      removalSignature(plan([table('a', ['id']), table('y', ['id'])], [table('a', ['id'])]))
    )
  })
})
