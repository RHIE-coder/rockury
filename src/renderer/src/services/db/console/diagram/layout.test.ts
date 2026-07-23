import { describe, it, expect } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { estimateNodeSize, layoutErd, type LayoutNode } from './layout'

const n = (id: string, width = 200, height = 100): LayoutNode => ({ id, width, height })

describe('layoutErd', () => {
  it('모든 노드에 좌표를 배정한다', () => {
    const pos = layoutErd([n('a'), n('b'), n('c')], [{ source: 'a', target: 'b' }])
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c'])
    for (const p of Object.values(pos)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('결정적 — 같은 입력이면 같은 좌표', () => {
    const nodes = [n('a'), n('b')]
    const edges = [{ source: 'a', target: 'b' }]
    expect(layoutErd(nodes, edges)).toEqual(layoutErd(nodes, edges))
  })

  it('LR 배치: 참조 대상이 소스보다 앞(작은 x) 랭크에 놓인다', () => {
    // a → b 이면 dagre 는 a 를 앞 랭크, b 를 다음 랭크에 둔다.
    const pos = layoutErd([n('a'), n('b')], [{ source: 'a', target: 'b' }], { direction: 'LR' })
    expect(pos.b.x).toBeGreaterThan(pos.a.x)
  })

  // 회귀: 자동 배치가 너무 붙으면 관계선 라벨(FK 이름 + 정책 배지)이 두 테이블 사이에 낄 자리가
  // 없어진다 → 연결된 두 랭크 사이 가로 간격은 라벨 폭(≈150px) 이상을 유지해야 한다.
  it('연결된 두 랭크 사이에 관계선 라벨이 들어갈 가로 간격을 둔다', () => {
    const pos = layoutErd([n('a', 200, 100), n('b', 200, 100)], [{ source: 'a', target: 'b' }])
    const gap = pos.b.x - (pos.a.x + 200)
    expect(gap).toBeGreaterThanOrEqual(150)
  })

  // 회귀: 같은 랭크에 쌓인 테이블끼리도 세로로 붙지 않아야(자기참조 루프가 위 노드를 덮지 않게).
  it('같은 랭크 노드끼리 세로 간격을 둔다', () => {
    const pos = layoutErd([n('a', 200, 100), n('b', 200, 100)], [])
    const gap = Math.abs(pos.b.y - pos.a.y) - 100
    expect(gap).toBeGreaterThanOrEqual(80)
  })

  it('자기참조 엣지가 있어도 예외 없이 좌표를 낸다', () => {
    const pos = layoutErd([n('a')], [{ source: 'a', target: 'a' }])
    expect(pos.a).toBeDefined()
  })

  it('존재하지 않는 노드를 가리키는 엣지는 무시', () => {
    const pos = layoutErd([n('a')], [{ source: 'a', target: 'ghost' }])
    expect(Object.keys(pos)).toEqual(['a'])
  })

  it('좌표는 좌상단 기준(중심 아님) — 음수로 안 새고 marginx 이상', () => {
    const pos = layoutErd([n('a', 200, 100)], [])
    // 단일 노드는 marginx/marginy(20)에서 시작, 중심-절반 변환 후에도 여백만큼 양수.
    expect(pos.a.x).toBeGreaterThanOrEqual(0)
    expect(pos.a.y).toBeGreaterThanOrEqual(0)
  })
})

describe('estimateNodeSize', () => {
  const mk = (nCols: number): TableDef => ({
    id: 't:x',
    designId: 'd',
    name: 'x',
    comment: '',
    columns: Array.from({ length: nCols }, (_, i) => ({
      id: `c:x.c${i}`,
      name: `c${i}`,
      type: 'int',
      nullable: false,
      defaultValue: null,
      comment: ''
    })),
    constraints: []
  })

  const col = (name: string, type: string) => ({
    id: `c:x.${name}`,
    name,
    type,
    nullable: false,
    defaultValue: null,
    comment: ''
  })
  const tbl = (name: string, columns: ReturnType<typeof col>[]): TableDef => ({
    id: `t:${name}`,
    designId: 'd',
    name,
    comment: '',
    columns,
    constraints: []
  })

  it('컬럼이 많을수록 높이가 커진다', () => {
    expect(estimateNodeSize(mk(10)).height).toBeGreaterThan(estimateNodeSize(mk(2)).height)
  })

  it('컬럼 0개여도 최소 높이 보장(1행 취급)', () => {
    expect(estimateNodeSize(mk(0)).height).toBe(estimateNodeSize(mk(1)).height)
  })

  // 회귀: 폭을 상수로 고정하면 긴 타입 문자열(예: 긴 ENUM)을 가진 테이블이
  // 실제 렌더보다 훨씬 좁게 추정돼 dagre 배치에서 이웃 테이블과 겹친다 → 폭은 내용에 비례해야 한다.
  it('긴 컬럼 타입일수록 폭이 넓어진다(상수 고정 아님)', () => {
    const narrow = estimateNodeSize(tbl('a', [col('id', 'int')])).width
    const wide = estimateNodeSize(
      tbl('orders', [
        col('id', 'BIGINT UNSIGNED'),
        col('status', "ENUM('pending','confirmed','shipped','delivered','cancelled','refunded')")
      ])
    ).width
    expect(wide).toBeGreaterThan(narrow)
    // 긴 ENUM 은 실제로 500px 을 훌쩍 넘는다 — 옛 상수(232)로는 절대 못 잡던 폭.
    expect(wide).toBeGreaterThan(400)
  })

  it('긴 컬럼명도 폭에 반영된다', () => {
    const short = estimateNodeSize(tbl('a', [col('c', 'int')])).width
    const long = estimateNodeSize(tbl('a', [col('very_long_descriptive_column_name', 'int')])).width
    expect(long).toBeGreaterThan(short)
  })

  it('배치 시 넓은 소스 테이블과 참조 대상이 가로로 겹치지 않는다', () => {
    const orders = tbl('orders', [
      col('id', 'BIGINT UNSIGNED'),
      col('status', "ENUM('pending','confirmed','shipped','delivered','cancelled','refunded')")
    ])
    const users = tbl('users', [col('id', 'BIGINT UNSIGNED')])
    const sizes = [orders, users].map((t) => ({ id: t.id, ...estimateNodeSize(t) }))
    const pos = layoutErd(sizes, [{ source: orders.id, target: users.id }])
    const ordersW = sizes.find((s) => s.id === orders.id)!.width
    // orders 오른쪽 끝보다 users 왼쪽이 더 오른쪽 → 겹침 없음.
    expect(pos[users.id].x).toBeGreaterThanOrEqual(pos[orders.id].x + ordersW)
  })
})
