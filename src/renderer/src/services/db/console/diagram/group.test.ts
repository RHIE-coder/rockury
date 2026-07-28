import { describe, expect, it } from 'vitest'
import {
  GROUP_COLLAPSED_H,
  GROUP_COLLAPSED_W,
  GROUP_HEADER_H,
  GROUP_MIN_H,
  GROUP_MIN_W,
  GROUP_PAD,
  GROUP_PALETTE,
  collapsedTableIds,
  groupAtPoint,
  groupColor,
  groupNodeId,
  groupOfTable,
  groupRect,
  groupDeletePhrase,
  groupRects,
  matchesGroupDeletePhrase,
  moveGroup,
  nextGroupAnchor,
  nextGroupId,
  rewireCollapsedEdges,
  setMembership,
  visibleTables,
  type DiagramGroup
} from './group'

const g = (over: Partial<DiagramGroup> & { id: string }): DiagramGroup => ({
  name: over.id,
  color: '',
  tableIds: [],
  collapsed: false,
  x: 0,
  y: 0,
  ...over
})

const SIZES = {
  't:users': { width: 200, height: 100 },
  't:orders': { width: 200, height: 100 },
  't:items': { width: 200, height: 100 }
}

// CASE-console-05C — 그룹 색 자동 배정
describe('groupColor (색 자동 배정)', () => {
  it('색을 안 고르면 목록 순서대로 팔레트를 돌려 쓴다', () => {
    expect(groupColor({ color: '' }, 0)).toBe(GROUP_PALETTE[0])
    expect(groupColor({ color: '' }, 1)).toBe(GROUP_PALETTE[1])
    // 팔레트를 한 바퀴 돌면 처음으로 돌아온다
    expect(groupColor({ color: '' }, GROUP_PALETTE.length)).toBe(GROUP_PALETTE[0])
  })

  it('고른 색은 순번과 무관하게 그대로 지킨다', () => {
    expect(groupColor({ color: 'rose' }, 0)).toBe('rose')
    expect(groupColor({ color: 'rose' }, 3)).toBe('rose')
  })

  it('팔레트에 없는 값은 자동 배정으로 떨어진다(저장본이 깨져도 화면이 안 죽는다)', () => {
    expect(groupColor({ color: '#ff00ff' }, 1)).toBe(GROUP_PALETTE[1])
  })
})

describe('nextGroupAnchor (새 그룹 자리)', () => {
  it('테이블이 없으면 왼쪽 위, 그룹 수만큼 아래로 어긋난다', () => {
    expect(nextGroupAnchor({}, [])).toEqual({ x: 40, y: 40 })
    expect(nextGroupAnchor({}, [g({ id: 'g1' })])).toEqual({ x: 40, y: 80 })
  })

  it('기존 내용의 오른쪽 빈 자리에 놓는다(테이블을 덮지 않게)', () => {
    const pos = { 't:users': { x: 0, y: 100 }, 't:orders': { x: 600, y: 300 } }
    expect(nextGroupAnchor(pos, [])).toEqual({ x: 920, y: 100 })
  })

  it('그룹을 여러 개 만들어도 서로 겹치지 않는다', () => {
    const pos = { 't:users': { x: 0, y: 0 } }
    const a = nextGroupAnchor(pos, [])
    const b = nextGroupAnchor(pos, [g({ id: 'g1' })])
    expect(b.y).toBeGreaterThan(a.y)
  })
})

// CASE-console-05G — 소속 테이블 동반 삭제 확인 문구
describe('groupDeletePhrase / matchesGroupDeletePhrase', () => {
  it('개수를 넣은 문구를 만든다', () => {
    expect(groupDeletePhrase(3)).toBe('3개 테이블도 함께 삭제합니다')
    expect(groupDeletePhrase(1)).toBe('1개 테이블도 함께 삭제합니다')
  })

  it('그대로 입력해야 통과하고, 앞뒤 공백만 눈감아 준다', () => {
    expect(matchesGroupDeletePhrase('3개 테이블도 함께 삭제합니다', 3)).toBe(true)
    expect(matchesGroupDeletePhrase('  3개 테이블도 함께 삭제합니다  ', 3)).toBe(true)
  })

  it('개수가 다르거나 문구가 어긋나면 막는다', () => {
    expect(matchesGroupDeletePhrase('2개 테이블도 함께 삭제합니다', 3)).toBe(false)
    expect(matchesGroupDeletePhrase('3개 테이블도 함께삭제합니다', 3)).toBe(false)
    expect(matchesGroupDeletePhrase('삭제', 3)).toBe(false)
    expect(matchesGroupDeletePhrase('', 3)).toBe(false)
  })
})

describe('nextGroupId', () => {
  it('빈 목록이면 g1, 이후 최대 순번 +1', () => {
    expect(nextGroupId([])).toBe('g1')
    expect(nextGroupId([g({ id: 'g1' }), g({ id: 'g3' })])).toBe('g4')
  })

  it('순번 꼴이 아닌 id 가 섞여 있어도 겹치지 않는다', () => {
    expect(nextGroupId([g({ id: 'legacy' }), g({ id: 'g2' })])).toBe('g3')
  })
})

// CASE-console-058 — 소속 판정·갱신
describe('setMembership / groupOfTable (소속)', () => {
  it('그룹에 넣으면 그 그룹에만 든다', () => {
    const next = setMembership([g({ id: 'g1' }), g({ id: 'g2' })], 't:users', 'g1')
    expect(next[0].tableIds).toEqual(['t:users'])
    expect(next[1].tableIds).toEqual([])
    expect(groupOfTable(next, 't:users')?.id).toBe('g1')
  })

  it('다른 그룹으로 옮기면 이전 그룹에서 빠진다 — 한 테이블은 최대 한 그룹', () => {
    const before = [g({ id: 'g1', tableIds: ['t:users'] }), g({ id: 'g2' })]
    const next = setMembership(before, 't:users', 'g2')
    expect(next[0].tableIds).toEqual([])
    expect(next[1].tableIds).toEqual(['t:users'])
  })

  it('null 이면 어느 그룹에도 안 속한다', () => {
    const next = setMembership([g({ id: 'g1', tableIds: ['t:users', 't:orders'] })], 't:users', null)
    expect(next[0].tableIds).toEqual(['t:orders'])
    expect(groupOfTable(next, 't:users')).toBeNull()
  })

  it('이미 그 그룹이면 목록을 그대로 둔다(중복 추가 없음)', () => {
    const before = [g({ id: 'g1', tableIds: ['t:users'] })]
    expect(setMembership(before, 't:users', 'g1')[0].tableIds).toEqual(['t:users'])
  })
})

// CASE-console-057 — 그룹 영역 계산
describe('groupRect (영역 계산)', () => {
  it('소속 상자를 여백과 함께 감싸고, 위쪽은 이름표만큼 더 연다', () => {
    const group = g({ id: 'g1', tableIds: ['t:users', 't:orders'] })
    const r = groupRect(group, { 't:users': { x: 100, y: 100 }, 't:orders': { x: 400, y: 300 } }, SIZES)
    expect(r.x).toBe(100 - GROUP_PAD)
    expect(r.y).toBe(100 - GROUP_PAD - GROUP_HEADER_H)
    // 가로: 100..600 → 500 + 여백 양쪽
    expect(r.width).toBe(500 + GROUP_PAD * 2)
    // 세로: 100..400 → 300 + 여백 양쪽 + 이름표
    expect(r.height).toBe(300 + GROUP_PAD * 2 + GROUP_HEADER_H)
  })

  it('소속이 없으면 기준점에 최소 크기 — 빈 그룹도 끌어다 놓을 자리가 있어야 한다', () => {
    const r = groupRect(g({ id: 'g1', x: 50, y: 60 }), {}, SIZES)
    expect(r).toEqual({ x: 50, y: 60, width: GROUP_MIN_W, height: GROUP_MIN_H })
  })

  it('소속이 하나뿐이라 좁아도 최소 크기 아래로는 안 내려간다', () => {
    const tiny = { 't:users': { width: 40, height: 30 } }
    const r = groupRect(g({ id: 'g1', tableIds: ['t:users'] }), { 't:users': { x: 0, y: 0 } }, tiny)
    expect(r.width).toBe(GROUP_MIN_W)
    expect(r.height).toBe(GROUP_MIN_H)
  })

  it('손으로 정한 크기가 있으면 소속을 옮겨도 그 크기·자리를 지킨다', () => {
    const group = g({ id: 'g1', tableIds: ['t:users'], x: 10, y: 20, w: 700, h: 500 })
    expect(groupRect(group, { 't:users': { x: 9999, y: 9999 } }, SIZES)).toEqual({
      x: 10,
      y: 20,
      width: 700,
      height: 500
    })
  })

  it('손으로 정한 크기도 최소 크기 아래로는 안 내려간다', () => {
    const r = groupRect(g({ id: 'g1', x: 0, y: 0, w: 10, h: 10 }), {}, SIZES)
    expect(r.width).toBe(GROUP_MIN_W)
    expect(r.height).toBe(GROUP_MIN_H)
  })

  it('접힘이 손으로 정한 크기보다 우선한다', () => {
    const group = g({ id: 'g1', tableIds: ['t:users'], collapsed: true, x: 5, y: 6, w: 900, h: 900 })
    expect(groupRect(group, {}, SIZES)).toEqual({
      x: 5,
      y: 6,
      width: GROUP_COLLAPSED_W,
      height: GROUP_COLLAPSED_H
    })
  })

  it('접히면 기준점에 상자 하나 크기만 남는다', () => {
    const group = g({ id: 'g1', tableIds: ['t:users'], collapsed: true, x: 10, y: 20 })
    const r = groupRect(group, { 't:users': { x: 999, y: 999 } }, SIZES)
    expect(r).toEqual({ x: 10, y: 20, width: GROUP_COLLAPSED_W, height: GROUP_COLLAPSED_H })
  })

  it('위치를 모르는 소속은 계산에서 빠진다(측정 전 한 프레임)', () => {
    const group = g({ id: 'g1', tableIds: ['t:users', 't:ghost'], x: 7, y: 8 })
    const r = groupRect(group, { 't:users': { x: 0, y: 0 } }, SIZES)
    expect(r.x).toBe(-GROUP_PAD)
  })
})

describe('groupAtPoint (놓은 자리 판정)', () => {
  const groups = [
    g({ id: 'big', tableIds: ['t:users', 't:orders'] }),
    g({ id: 'small', tableIds: ['t:items'] })
  ]
  const pos = {
    't:users': { x: 0, y: 0 },
    't:orders': { x: 900, y: 700 },
    't:items': { x: 300, y: 300 }
  }
  const rects = groupRects(groups, pos, SIZES)

  it('영역 안이면 그 그룹', () => {
    expect(groupAtPoint(groups, rects, { x: 50, y: 50 })).toBe('big')
  })

  it('겹치면 더 좁은(안쪽) 그룹이 이긴다', () => {
    expect(groupAtPoint(groups, rects, { x: 350, y: 350 })).toBe('small')
  })

  it('어느 영역에도 없으면 null', () => {
    expect(groupAtPoint(groups, rects, { x: -5000, y: -5000 })).toBeNull()
  })
})

// CASE-console-059 — 그룹 이동 → 소속 노드 동반 이동
describe('moveGroup (같이 움직이기)', () => {
  it('그룹 이동량을 소속 노드에 그대로 더한다', () => {
    const groups = [g({ id: 'g1', tableIds: ['t:users', 't:orders'], x: 10, y: 10 })]
    const pos = { 't:users': { x: 100, y: 100 }, 't:orders': { x: 200, y: 50 }, 't:items': { x: 0, y: 0 } }
    const out = moveGroup(groups, pos, 'g1', 40, -25)
    expect(out.positions['t:users']).toEqual({ x: 140, y: 75 })
    expect(out.positions['t:orders']).toEqual({ x: 240, y: 25 })
    // 소속 아닌 노드는 그대로
    expect(out.positions['t:items']).toEqual({ x: 0, y: 0 })
    // 기준점도 함께 움직인다
    expect(out.groups[0]).toMatchObject({ x: 50, y: -15 })
  })

  it('접힌 그룹도 숨은 소속을 함께 민다 — 펴면 상대 배치가 그대로', () => {
    const groups = [g({ id: 'g1', tableIds: ['t:users'], collapsed: true })]
    const out = moveGroup(groups, { 't:users': { x: 0, y: 0 } }, 'g1', 10, 10)
    expect(out.positions['t:users']).toEqual({ x: 10, y: 10 })
  })

  it('움직임이 0 이거나 없는 그룹이면 입력을 그대로 돌려준다', () => {
    const groups = [g({ id: 'g1' })]
    const pos = { 't:users': { x: 1, y: 1 } }
    expect(moveGroup(groups, pos, 'g1', 0, 0).positions).toBe(pos)
    expect(moveGroup(groups, pos, 'nope', 5, 5).positions).toBe(pos)
  })
})

describe('collapsedTableIds', () => {
  it('접힌 그룹의 소속만 모은다', () => {
    const groups = [
      g({ id: 'g1', tableIds: ['t:users'], collapsed: true }),
      g({ id: 'g2', tableIds: ['t:orders'] })
    ]
    expect([...collapsedTableIds(groups)]).toEqual(['t:users'])
  })
})

// CASE-console-05B — 필터 합성
describe('visibleTables (관계만 + 그룹만 보기)', () => {
  const tables = [{ id: 't:users' }, { id: 't:orders' }, { id: 't:lonely' }]
  const groups = [g({ id: 'g1', tableIds: ['t:users'] }), g({ id: 'g2', tableIds: ['t:orders'] })]

  it('아무 필터도 안 켜면 전체', () => {
    expect(visibleTables(tables, { groups }).map((t) => t.id)).toEqual(['t:users', 't:orders', 't:lonely'])
  })

  it('관계만 → 고립 테이블이 빠진다', () => {
    const out = visibleTables(tables, { hideIsolated: true, isolated: new Set(['t:lonely']), groups })
    expect(out.map((t) => t.id)).toEqual(['t:users', 't:orders'])
  })

  it('그룹만 보기 → 켠 그룹의 소속만', () => {
    const out = visibleTables(tables, { groups, onlyGroups: new Set(['g1']) })
    expect(out.map((t) => t.id)).toEqual(['t:users'])
  })

  it('둘 다 켜면 둘 다 걸린다(교집합)', () => {
    const out = visibleTables(tables, {
      hideIsolated: true,
      isolated: new Set(['t:users']),
      groups,
      onlyGroups: new Set(['g1', 'g2'])
    })
    expect(out.map((t) => t.id)).toEqual(['t:orders'])
  })

  it('켠 그룹이 하나도 없으면 그룹 필터는 통과(빈 화면이 되지 않는다)', () => {
    expect(visibleTables(tables, { groups, onlyGroups: new Set() }).length).toBe(3)
  })
})

// CASE-console-05A — 접힌 그룹의 관계선
describe('rewireCollapsedEdges (접힌 그룹의 관계선)', () => {
  const edges = [
    { id: 'e1', source: 't:orders', target: 't:users' },
    { id: 'e2', source: 't:items', target: 't:users' },
    { id: 'e3', source: 't:items', target: 't:orders' },
    { id: 'e4', source: 't:outside', target: 't:elsewhere' }
  ]

  it('접힌 그룹이 없으면 원래 관계 그대로', () => {
    const out = rewireCollapsedEdges(edges, [g({ id: 'g1', tableIds: ['t:users'] })])
    expect(out.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(out.every((e) => e.merged === 1)).toBe(true)
  })

  it('그룹 안↔안 관계는 감춘다', () => {
    const out = rewireCollapsedEdges(edges, [
      g({ id: 'g1', tableIds: ['t:users', 't:orders'], collapsed: true })
    ])
    expect(out.find((e) => e.from.includes('e1'))).toBeUndefined()
  })

  it('한쪽 끝만 접힌 그룹이면 그 끝을 그룹 상자로 옮겨 남긴다 — 관계가 사라지지 않는다', () => {
    const out = rewireCollapsedEdges(edges, [
      g({ id: 'g1', tableIds: ['t:users', 't:orders'], collapsed: true })
    ])
    // e2(items→users), e3(items→orders) 는 같은 끝점 쌍(items→grp:g1)으로 합쳐진다
    const merged = out.find((e) => e.source === 't:items')
    expect(merged?.target).toBe(groupNodeId('g1'))
    expect(merged?.merged).toBe(2)
    expect(merged?.from).toEqual(['e2', 'e3'])
    // 그룹과 무관한 관계는 그대로
    expect(out.find((e) => e.id === 'e4')).toBeDefined()
  })

  it('양끝이 서로 다른 접힌 그룹이면 상자끼리 잇는다', () => {
    const out = rewireCollapsedEdges(edges, [
      g({ id: 'g1', tableIds: ['t:users'], collapsed: true }),
      g({ id: 'g2', tableIds: ['t:orders'], collapsed: true })
    ])
    const e1 = out.find((e) => e.from.includes('e1'))
    expect(e1).toMatchObject({ source: groupNodeId('g2'), target: groupNodeId('g1') })
  })
})
