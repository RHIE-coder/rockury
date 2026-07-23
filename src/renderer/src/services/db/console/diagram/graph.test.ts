import { describe, it, expect } from 'vitest'
import type { Column, Constraint, TableDef } from '../../workspaces/definition/types'
import { buildErd } from './graph'

const col = (table: string, name: string, nullable = false): Column => ({
  id: `c:${table}.${name}`,
  name,
  type: 'int',
  nullable,
  defaultValue: null,
  comment: ''
})

const table = (name: string, columns: Column[], constraints: Constraint[] = []): TableDef => ({
  id: `t:${name}`,
  designId: 'd',
  name,
  comment: '',
  columns,
  constraints
})

const pk = (t: string, cols: string[]): Constraint => ({
  id: `k:${t}.pk`,
  kind: 'pk',
  name: `${t}_pk`,
  columns: cols.map((c) => ({ columnId: `c:${t}.${c}` }))
})

const uk = (t: string, name: string, cols: string[]): Constraint => ({
  id: `k:${t}.${name}`,
  kind: 'uk',
  name,
  columns: cols.map((c) => ({ columnId: `c:${t}.${c}` }))
})

const fk = (
  t: string,
  name: string,
  cols: string[],
  refTable: string,
  refColumns: string[],
  extra: Partial<Constraint> = {}
): Constraint => ({
  id: `k:${t}.${name}`,
  kind: 'fk',
  name,
  columns: cols.map((c) => ({ columnId: `c:${t}.${c}` })),
  refTable,
  refColumns,
  ...extra
})

describe('buildErd', () => {
  it('테이블 1개당 노드 1개(순서 유지)', () => {
    const { nodes } = buildErd([table('users', [col('users', 'id')]), table('orders', [col('orders', 'id')])])
    expect(nodes.map((n) => n.id)).toEqual(['t:users', 't:orders'])
  })

  it('FK → 엣지 생성(source=FK보유, target=참조)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const orders = table(
      'orders',
      [col('orders', 'id'), col('orders', 'user_id')],
      [pk('orders', ['id']), fk('orders', 'fk_user', ['user_id'], 'users', ['id'], { onDelete: 'CASCADE' })]
    )
    const { edges } = buildErd([users, orders])
    expect(edges).toHaveLength(1)
    const e = edges[0]
    expect(e).toMatchObject({
      id: 't:orders::fk_user',
      source: 't:orders',
      target: 't:users',
      sourceColumnId: 'c:orders.user_id',
      label: 'user_id → id',
      onDelete: 'CASCADE',
      selfRef: false
    })
  })

  it('일반 FK(비유니크 컬럼)는 N(many) — isUnique false', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const orders = table(
      'orders',
      [col('orders', 'id'), col('orders', 'user_id')],
      [pk('orders', ['id']), fk('orders', 'fk_user', ['user_id'], 'users', ['id'])]
    )
    expect(buildErd([users, orders]).edges[0].isUnique).toBe(false)
  })

  it('FK 소스 컬럼이 UK/PK 와 일치하면 1:1 — isUnique true', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const profile = table(
      'profile',
      [col('profile', 'user_id')],
      [
        uk('profile', 'uq_user', ['user_id']),
        fk('profile', 'fk_user', ['user_id'], 'users', ['id'])
      ]
    )
    expect(buildErd([users, profile]).edges[0].isUnique).toBe(true)
  })

  it('NULL 허용 FK 컬럼이면 nullable true', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const orders = table(
      'orders',
      [col('orders', 'id'), col('orders', 'user_id', true)],
      [fk('orders', 'fk_user', ['user_id'], 'users', ['id'])]
    )
    expect(buildErd([users, orders]).edges[0].nullable).toBe(true)
  })

  it('참조 테이블이 스키마에 없으면 엣지 없음', () => {
    const orders = table(
      'orders',
      [col('orders', 'user_id')],
      [fk('orders', 'fk_user', ['user_id'], 'users', ['id'])]
    )
    expect(buildErd([orders]).edges).toHaveLength(0)
  })

  it('자기참조 FK → selfRef true', () => {
    const emp = table(
      'employees',
      [col('employees', 'id'), col('employees', 'manager_id', true)],
      [pk('employees', ['id']), fk('employees', 'fk_mgr', ['manager_id'], 'employees', ['id'])]
    )
    const { edges } = buildErd([emp])
    expect(edges[0].selfRef).toBe(true)
    expect(edges[0].source).toBe('t:employees')
    expect(edges[0].target).toBe('t:employees')
  })

  it('복합 FK — 라벨은 컬럼명 순서 유지, sourceColumnId 는 첫 컬럼', () => {
    const parent = table(
      'parent',
      [col('parent', 'a'), col('parent', 'b')],
      [pk('parent', ['a', 'b'])]
    )
    const child = table(
      'child',
      [col('child', 'pa'), col('child', 'pb')],
      [fk('child', 'fk_p', ['pa', 'pb'], 'parent', ['a', 'b'])]
    )
    const e = buildErd([parent, child]).edges[0]
    expect(e.label).toBe('pa, pb → a, b')
    expect(e.sourceColumnId).toBe('c:child.pa')
  })
})

describe('buildErd — 라벨 레인(labelOffset)', () => {
  // 라벨 앵커는 소스 FK 컬럼 행 옆 → 컬럼이 다르면 자연 분리라 오프셋 불필요.
  it('서로 다른 컬럼에서 나가는 관계선들은 전부 0 (허브 수렴·소스 발산 포함)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const posts = table('posts', [col('posts', 'user_id')], [fk('posts', 'fk_u', ['user_id'], 'users', ['id'])])
    const comments = table('comments', [col('comments', 'user_id')], [fk('comments', 'fk_u', ['user_id'], 'users', ['id'])])
    const junction = table(
      'junction',
      [col('junction', 'user_id'), col('junction', 'post_id')],
      [
        fk('junction', 'fk_u', ['user_id'], 'users', ['id']),
        fk('junction', 'fk_p', ['post_id'], 'posts', ['id'])
      ]
    )
    const offsets = buildErd([users, posts, comments, junction]).edges.map((e) => e.labelOffset)
    expect(offsets).toEqual([0, 0, 0, 0])
  })

  // 유일하게 겹칠 수 있는 경우: 같은 컬럼이 복수 FK 에 참여(앵커가 동일 지점).
  it('같은 컬럼에서 두 FK 가 나가면 -0.5, +0.5 로 세로 분산', () => {
    const a = table('a', [col('a', 'id')], [pk('a', ['id'])])
    const b = table('b', [col('b', 'id')], [pk('b', ['id'])])
    const child = table(
      'child',
      [col('child', 'ref_id')],
      [
        fk('child', 'fk_a', ['ref_id'], 'a', ['id']),
        fk('child', 'fk_b', ['ref_id'], 'b', ['id'])
      ]
    )
    const offsets = buildErd([a, b, child]).edges.map((e) => e.labelOffset)
    expect(offsets).toEqual([-0.5, 0.5])
  })

  it('자기참조는 레인 분산에서 제외(항상 0)', () => {
    const emp = table(
      'employees',
      [col('employees', 'id'), col('employees', 'manager_id', true)],
      [pk('employees', ['id']), fk('employees', 'fk_mgr', ['manager_id'], 'employees', ['id'])]
    )
    expect(buildErd([emp]).edges[0].labelOffset).toBe(0)
  })
})
