import { describe, it, expect } from 'vitest'
import type { TableDef } from '../../workspaces/definition/types'
import { estimateEdgeLabelWidth, estimateNodeSize, layoutErd, mergePositions, type LayoutNode } from './layout'

// CASE-remote-056 — 위치 병합 저장
describe('mergePositions (배치 저장 병합)', () => {
  const known = ['t:users', 't:orders', 't:hidden']

  it('보이는 노드만 저장해도 안 보이는 노드의 자리가 남는다', () => {
    const stored = { 't:users': { x: 1, y: 1 }, 't:hidden': { x: 9, y: 9 } }
    const visible = { 't:users': { x: 50, y: 50 } }
    expect(mergePositions(stored, visible, known)).toEqual({
      't:users': { x: 50, y: 50 }, // 보이는 노드는 새 값으로
      't:hidden': { x: 9, y: 9 } // 필터로 숨은 노드는 그대로 보존
    })
  })

  it('스키마에서 없어진 테이블만 정리한다', () => {
    const stored = { 't:users': { x: 1, y: 1 }, 't:gone': { x: 2, y: 2 } }
    expect(mergePositions(stored, {}, known)).toEqual({ 't:users': { x: 1, y: 1 } })
  })

  it('아는 테이블 목록이 비면 아무것도 지우지 않는다(스키마 미로딩)', () => {
    const stored = { 't:users': { x: 1, y: 1 } }
    expect(mergePositions(stored, {}, [])).toEqual(stored)
  })

  it('새 노드는 그대로 더해진다', () => {
    expect(mergePositions({}, { 't:orders': { x: 3, y: 4 } }, known)).toEqual({ 't:orders': { x: 3, y: 4 } })
  })
})

const n = (id: string, width = 200, height = 100): LayoutNode => ({ id, width, height })

// CASE-remote-05F — 그룹 기준 자동 배치
describe('layoutErd (그룹 묶음 배치)', () => {
  const four = [n('a'), n('b'), n('c'), n('d')]
  const chain = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' }
  ]
  const spread = (pos: ReturnType<typeof layoutErd>, ids: string[]): number => {
    const ys = ids.map((id) => pos[id].y)
    return Math.max(...ys) - Math.min(...ys)
  }

  it('묶음을 안 주면 예전 배치와 완전히 같다(그룹 없는 다이어그램은 안 바뀐다)', () => {
    expect(layoutErd(four, chain, { clusters: {} })).toEqual(layoutErd(four, chain))
  })

  it('묶음을 주면 같은 묶음 노드가 서로 더 붙는다', () => {
    const plain = layoutErd(four, chain)
    const clustered = layoutErd(four, chain, { clusters: { a: 'g1', c: 'g1', b: 'g2', d: 'g2' } })
    // a·c 는 사슬에서 떨어져 있어 묶음이 없으면 세로로 벌어진다 → 묶으면 그 벌어짐이 줄어든다.
    expect(spread(clustered, ['a', 'c'])).toBeLessThanOrEqual(spread(plain, ['a', 'c']))
    // 모든 노드에 좌표가 그대로 붙는다(묶음 노드가 결과에 새지 않는다).
    expect(Object.keys(clustered).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('묶음에 없는 노드가 섞여 있어도, 없는 노드를 가리켜도 안 터진다', () => {
    const pos = layoutErd(four, chain, { clusters: { a: 'g1', nope: 'g1' } })
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

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

  // 회귀: 랭크 간격이 고정(180)이면 긴 라벨("card_id → id  D:SET NULL  U:NO ACTION")이
  // 참조 테이블 밑으로 깔려 글자가 잘려 보였다 → 간격은 가장 긴 라벨을 품어야 한다.
  it('긴 관계선 라벨이 통째로 들어갈 만큼 랭크 간격을 벌린다', () => {
    const labelWidth = estimateEdgeLabelWidth({
      label: 'detail_fetched_at → id',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    })
    const pos = layoutErd(
      [n('a', 200, 100), n('b', 200, 100)],
      [{ source: 'a', target: 'b', labelWidth }]
    )
    const gap = pos.b.x - (pos.a.x + 200)
    // 라벨 앵커(소스 핸들 +26px) 뒤로 라벨 전체가 들어가야 한다.
    expect(gap).toBeGreaterThanOrEqual(labelWidth + 26)
    expect(gap).toBeGreaterThan(180) // 기본 간격보다 실제로 넓어졌다
  })

  it('짧은 라벨이면 기본 간격을 좁히지 않는다', () => {
    const pos = layoutErd(
      [n('a', 200, 100), n('b', 200, 100)],
      [{ source: 'a', target: 'b', labelWidth: estimateEdgeLabelWidth({ label: 'a → b' }) }]
    )
    expect(pos.b.x - (pos.a.x + 200)).toBeGreaterThanOrEqual(180)
  })

  it('병적으로 긴 라벨도 랭크 간격 상한(520)을 넘기지 않는다', () => {
    const pos = layoutErd(
      [n('a', 200, 100), n('b', 200, 100)],
      [{ source: 'a', target: 'b', labelWidth: 5000 }]
    )
    expect(pos.b.x - (pos.a.x + 200)).toBeLessThanOrEqual(520)
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

describe('estimateEdgeLabelWidth', () => {
  it('라벨이 길수록 넓어진다', () => {
    const short = estimateEdgeLabelWidth({ label: 'a → b' })
    const long = estimateEdgeLabelWidth({ label: 'very_long_fk_column_name → id' })
    expect(long).toBeGreaterThan(short)
  })

  // 카드형(2줄)이므로 정책 줄은 라벨 줄과 **더해지지 않고** 더 넓은 쪽만 반영된다
  // → 한 줄로 늘어놓던 옛 버전보다 좁아 랭크가 덜 벌어진다.
  it('정책 줄은 라벨 줄과 합산되지 않고 최대치만 반영(2줄 카드)', () => {
    const long = 'very_long_fk_column_name → id' // 라벨 줄이 훨씬 길다
    expect(estimateEdgeLabelWidth({ label: long, onDelete: 'CASCADE' })).toBe(
      estimateEdgeLabelWidth({ label: long })
    )
  })

  it('라벨이 짧고 정책이 길면 정책 줄이 폭을 정한다', () => {
    const bare = estimateEdgeLabelWidth({ label: 'a → b' })
    const withPolicy = estimateEdgeLabelWidth({
      label: 'a → b',
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION'
    })
    expect(withPolicy).toBeGreaterThan(bare)
  })

  it('자기참조는 노드 위 루프에 얹히므로 랭크 간격과 무관(0)', () => {
    expect(estimateEdgeLabelWidth({ label: 'parent_id → id', selfRef: true })).toBe(0)
  })

  it('내용이 없으면 0', () => {
    expect(estimateEdgeLabelWidth({})).toBe(0)
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
