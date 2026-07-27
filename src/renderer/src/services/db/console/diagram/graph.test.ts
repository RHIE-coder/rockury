import { describe, it, expect } from 'vitest'
import type { Column, Constraint, TableDef } from '../../workspaces/definition/types'
import { buildErd, LABEL_LANE_H } from './graph'

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

describe('buildErd — 라벨 카드 레인(labelShiftY)', () => {
  // 카드는 컬럼 행(22px)보다 높다 → 멀리 떨어진 행에서 나가는 라벨은 저절로 안 겹쳐 보정 0.
  it('행이 충분히 떨어진 FK 들은 보정 없음(0)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const posts = table('posts', [col('posts', 'id')], [pk('posts', ['id'])])
    // FK 컬럼이 0행/4행 → 88px 차 ≥ 레인(42px)
    const junction = table(
      'junction',
      [
        col('junction', 'user_id'),
        col('junction', 'a'),
        col('junction', 'b'),
        col('junction', 'c'),
        col('junction', 'post_id')
      ],
      [
        fk('junction', 'fk_u', ['user_id'], 'users', ['id']),
        fk('junction', 'fk_p', ['post_id'], 'posts', ['id'])
      ]
    )
    const shifts = buildErd([users, posts, junction]).edges.map((e) => e.labelShiftY)
    expect(shifts).toEqual([0, 0])
  })

  // 회귀: 카드형 라벨은 22px 행 간격보다 높아, 붙어 있는 FK 컬럼끼리 카드가 겹쳤다.
  it('이웃 행 FK 두 개는 레인만큼 벌어진다(위/아래 반씩)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const posts = table('posts', [col('posts', 'id')], [pk('posts', ['id'])])
    const junction = table(
      'junction',
      [col('junction', 'user_id'), col('junction', 'post_id')],
      [
        fk('junction', 'fk_u', ['user_id'], 'users', ['id']),
        fk('junction', 'fk_p', ['post_id'], 'posts', ['id'])
      ]
    )
    const edges = buildErd([users, posts, junction]).edges
    const [u, p] = edges
    // 앵커 Y(행×22) + 보정 = 실제 카드 Y → 둘의 간격이 레인(42px) 이상이어야 안 겹친다.
    const y = (e: (typeof edges)[number]) => e.sourceRow * 22 + e.labelShiftY
    expect(Math.abs(y(p) - y(u))).toBeGreaterThanOrEqual(LABEL_LANE_H)
    // 무리의 중심은 원래 위치를 지킨다(한쪽으로 쏠리지 않음).
    expect(y(u) + y(p)).toBe(u.sourceRow * 22 + p.sourceRow * 22)
  })

  it('같은 컬럼에서 두 FK 가 나가면 위·아래로 반씩 분산', () => {
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
    const shifts = buildErd([a, b, child]).edges.map((e) => e.labelShiftY)
    expect(shifts).toEqual([-LABEL_LANE_H / 2, LABEL_LANE_H / 2])
  })

  it('세 개가 몰려도 서로 레인 간격을 지킨다', () => {
    const t = (name: string) => table(name, [col(name, 'id')], [pk(name, ['id'])])
    const child = table(
      'child',
      [col('child', 'a_id'), col('child', 'b_id'), col('child', 'c_id')],
      [
        fk('child', 'fk_a', ['a_id'], 'a', ['id']),
        fk('child', 'fk_b', ['b_id'], 'b', ['id']),
        fk('child', 'fk_c', ['c_id'], 'c', ['id'])
      ]
    )
    const edges = buildErd([t('a'), t('b'), t('c'), child]).edges
    const ys = edges.map((e) => e.sourceRow * 22 + e.labelShiftY).sort((x, z) => x - z)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(LABEL_LANE_H)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(LABEL_LANE_H)
  })

  it('다른 테이블에서 나가는 라벨끼리는 서로 밀지 않는다(노드 간격이 이미 벌려 둠)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const p1 = table('p1', [col('p1', 'user_id')], [fk('p1', 'fk_u', ['user_id'], 'users', ['id'])])
    const p2 = table('p2', [col('p2', 'user_id')], [fk('p2', 'fk_u', ['user_id'], 'users', ['id'])])
    expect(buildErd([users, p1, p2]).edges.map((e) => e.labelShiftY)).toEqual([0, 0])
  })

  it('자기참조는 레인 분산에서 제외(항상 0)', () => {
    const emp = table(
      'employees',
      [col('employees', 'id'), col('employees', 'manager_id', true)],
      [pk('employees', ['id']), fk('employees', 'fk_mgr', ['manager_id'], 'employees', ['id'])]
    )
    expect(buildErd([emp]).edges[0].labelShiftY).toBe(0)
  })

  it('소스 FK 컬럼의 행 번호를 그대로 실어 준다(앵커 Y 계산용)', () => {
    const users = table('users', [col('users', 'id')], [pk('users', ['id'])])
    const posts = table(
      'posts',
      [col('posts', 'id'), col('posts', 'title'), col('posts', 'user_id')],
      [fk('posts', 'fk_u', ['user_id'], 'users', ['id'])]
    )
    expect(buildErd([users, posts]).edges[0].sourceRow).toBe(2)
  })
})
