import { describe, expect, it } from 'vitest'
import {
  activeTab,
  clearContextEverywhere,
  closeTab,
  detachTab,
  dropIndexAt,
  fromSession,
  insertTab,
  keepContextWithin,
  moveActiveTab,
  moveTab,
  nextTabId,
  normalizeTabSet,
  openTab,
  pulledOutOfStrip,
  seedContext,
  selectTab,
  selectTabAt,
  setActiveContext,
  stepTab,
  tabTitle,
  TEAR_OFF_MARGIN,
  toSession,
  type TabSet
} from './tabs'
import type { Module, View } from './types'

const loc = (serviceId: string, moduleId: string, viewId: string | null = null) => ({
  serviceId,
  moduleId,
  viewId
})

function set(...ids: string[]): TabSet {
  return {
    tabs: ids.map((id) => ({ id, ...loc('db', id), context: {} })),
    activeTabId: ids[0]
  }
}

describe('nextTabId — 쓰이지 않는 가장 작은 번호', () => {
  it('빈 목록이면 t1', () => {
    expect(nextTabId([])).toBe('t1')
  })

  it('중간이 비면 그 번호를 다시 쓴다', () => {
    expect(nextTabId(set('t1', 't3').tabs)).toBe('t2')
  })

  it('연달아 열어도 겹치지 않는다', () => {
    let s: TabSet = { tabs: [{ id: 't1', ...loc('db', 'remote'), context: {} }], activeTabId: 't1' }
    for (let i = 0; i < 5; i++) s = openTab(s, loc('db', 'remote'))
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(s.tabs.length)
  })
})

describe('openTab — 활성 오른쪽에 끼운다', () => {
  it('새 탭이 활성 바로 뒤에 서고, 그 탭으로 옮겨 간다', () => {
    const s = openTab({ ...set('t1', 't2', 't3'), activeTabId: 't1' }, loc('api', 'studio', 'specs'))
    expect(s.tabs.map((t) => t.id)).toEqual(['t1', 't4', 't2', 't3'])
    expect(s.activeTabId).toBe('t4')
    expect(activeTab(s)).toMatchObject({ serviceId: 'api', moduleId: 'studio', viewId: 'specs' })
  })

  it('활성이 맨 끝이면 끝에 붙는다', () => {
    const s = openTab({ ...set('t1', 't2'), activeTabId: 't2' }, loc('db', 'remote'))
    expect(s.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('탭 자신을 자리로 넘겨도 id 는 새로 짓는다 — 회귀', () => {
    // 탭 줄의 `+` 가 넘기는 값이 바로 활성 탭이다. 예전엔 그 탭을 통째로 펼쳐 id 까지 물려받아,
    // 같은 id 를 가진 탭이 두 장 생기고 둘 다 켜진 것처럼 보였다(실측).
    const before: TabSet = { tabs: [{ id: 't1', ...loc('db', 'remote', 'collections'), context: {} }], activeTabId: 't1' }
    const after = openTab(before, activeTab(before))
    expect(after.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(after.activeTabId).toBe('t2')
    expect(after.tabs[1]).toEqual({ id: 't2', ...loc('db', 'remote', 'collections'), context: {} })
  })
})

describe('closeTab', () => {
  it('마지막 한 장은 안 닫는다 — 실수로 앱이 꺼지는 길을 막는다', () => {
    const s = set('t1')
    expect(closeTab(s, 't1')).toBe(s)
  })

  it('활성 탭을 닫으면 오른쪽으로 옮겨 간다', () => {
    const s = closeTab({ ...set('t1', 't2', 't3'), activeTabId: 't2' }, 't2')
    expect(s.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(s.activeTabId).toBe('t3')
  })

  it('오른쪽이 없으면 왼쪽으로 옮겨 간다', () => {
    const s = closeTab({ ...set('t1', 't2'), activeTabId: 't2' }, 't2')
    expect(s.activeTabId).toBe('t1')
  })

  it('활성이 아닌 탭을 닫아도 보던 자리는 안 바뀐다', () => {
    const s = closeTab({ ...set('t1', 't2', 't3'), activeTabId: 't3' }, 't1')
    expect(s.activeTabId).toBe('t3')
  })

  it('없는 탭을 닫으라 하면 아무것도 안 바뀐다', () => {
    const s = set('t1', 't2')
    expect(closeTab(s, 't9')).toBe(s)
  })
})

describe('moveActiveTab — 자리 옮김은 활성 탭에만 걸린다', () => {
  it('활성 탭만 바뀌고 나머지는 그대로다', () => {
    const s = moveActiveTab({ ...set('t1', 't2'), activeTabId: 't2' }, loc('infra', 'catalog'))
    expect(s.tabs[0]).toMatchObject({ id: 't1', serviceId: 'db' })
    expect(s.tabs[1]).toMatchObject({ id: 't2', serviceId: 'infra', moduleId: 'catalog' })
  })

  it('같은 자리로 옮기면 같은 객체를 그대로 돌려준다 — 헛도는 구독·저장 방지', () => {
    const s = { tabs: [{ id: 't1', ...loc('db', 'remote', 'collections'), context: {} }], activeTabId: 't1' }
    expect(moveActiveTab(s, loc('db', 'remote', 'collections'))).toBe(s)
  })
})

describe('selectTab', () => {
  it('없는 탭을 고르라 하면 아무것도 안 바뀐다 — 지워진 탭을 가리키는 옛 클릭 방어', () => {
    const s = set('t1', 't2')
    expect(selectTab(s, 't9')).toBe(s)
    expect(selectTab(s, 't2').activeTabId).toBe('t2')
  })
})

describe('moveTab — 끌어서 자리 옮기기', () => {
  it('앞으로도 뒤로도 옮긴다', () => {
    expect(moveTab(set('t1', 't2', 't3'), 't3', 0).tabs.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
    expect(moveTab(set('t1', 't2', 't3'), 't1', 2).tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('보고 있던 탭은 안 바뀐다 — 자리 옮기기와 고르기는 다른 일이다', () => {
    const s = moveTab({ ...set('t1', 't2', 't3'), activeTabId: 't2' }, 't3', 0)
    expect(s.activeTabId).toBe('t2')
  })

  it('제자리로 옮기면 같은 객체를 그대로 돌려준다 — 헛도는 구독·보고 방지', () => {
    const s = set('t1', 't2')
    expect(moveTab(s, 't1', 0)).toBe(s)
  })

  it('범위를 벗어난 자리는 양 끝으로 조인다', () => {
    expect(moveTab(set('t1', 't2', 't3'), 't1', 99).tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect(moveTab(set('t1', 't2', 't3'), 't3', -5).tabs.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
  })

  it('없는 탭을 옮기라 하면 아무것도 안 바뀐다', () => {
    const s = set('t1', 't2')
    expect(moveTab(s, 't9', 0)).toBe(s)
  })
})

describe('selectTabAt · stepTab — 키로 고르기', () => {
  it('번호로 고른다', () => {
    expect(selectTabAt(set('t1', 't2', 't3'), 1).activeTabId).toBe('t2')
  })

  it('번호가 탭 수를 넘으면 마지막 탭 — 브라우저의 ⌘9 와 같다', () => {
    expect(selectTabAt(set('t1', 't2'), 8).activeTabId).toBe('t2')
  })

  it('옆 탭으로 가고, 끝에서는 반대쪽 끝으로 감는다', () => {
    const s = set('t1', 't2', 't3')
    expect(stepTab(s, 1).activeTabId).toBe('t2')
    expect(stepTab(s, -1).activeTabId).toBe('t3')
    expect(stepTab({ ...s, activeTabId: 't3' }, 1).activeTabId).toBe('t1')
  })
})

describe('detachTab — 창 밖으로 끌어 내기', () => {
  it('탭을 지우고 떼어냈다고 알린다', () => {
    const got = detachTab(set('t1', 't2'), 't1')
    expect(got.detached).toBe(true)
    expect(got.set.tabs.map((t) => t.id)).toEqual(['t2'])
  })

  it('한 장뿐이면 없던 일로 한다 — 빈 창을 남길 순 없다', () => {
    const s = set('t1')
    const got = detachTab(s, 't1')
    expect(got.detached).toBe(false)
    expect(got.set).toBe(s)
  })
})

describe('pulledOutOfStrip — 탭 줄 밖으로 끌어 냈나', () => {
  // 창 위에서 36px 자리에 놓인 높이 32 의 탭 줄.
  const strip = { top: 36, bottom: 68 }

  it('줄 안이면 아니다 (자리 옮기기다)', () => {
    expect(pulledOutOfStrip(36, strip)).toBe(false)
    expect(pulledOutOfStrip(52, strip)).toBe(false)
    expect(pulledOutOfStrip(68, strip)).toBe(false)
  })

  it('여유 폭 안에서는 아직 아니다 — 손 떨림이 창을 만들면 안 된다', () => {
    expect(pulledOutOfStrip(68 + TEAR_OFF_MARGIN, strip)).toBe(false)
    expect(pulledOutOfStrip(36 - TEAR_OFF_MARGIN, strip)).toBe(false)
  })

  it('여유 폭을 넘어 위아래로 벗어나면 맞다', () => {
    expect(pulledOutOfStrip(68 + TEAR_OFF_MARGIN + 1, strip)).toBe(true)
    expect(pulledOutOfStrip(36 - TEAR_OFF_MARGIN - 1, strip)).toBe(true)
  })

  it('창을 꽉 채워도 판정이 산다 — 세로만 보므로 "창 밖"이 없어도 떨어져 나간다', () => {
    // 예전 판정("놓은 자리가 창 밖인가")이 전체화면에서 영영 거짓이던 자리.
    expect(pulledOutOfStrip(900, strip)).toBe(true)
  })
})

describe('dropIndexAt — 어느 틈에 떨어지나', () => {
  // 폭 100 짜리 탭 셋: [0,100) [100,200) [200,300)
  const boxes = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ]

  it('탭의 반보다 왼쪽이면 그 탭 앞이다', () => {
    expect(dropIndexAt(boxes, 10)).toBe(0)
    expect(dropIndexAt(boxes, 120)).toBe(1)
    expect(dropIndexAt(boxes, 210)).toBe(2)
  })

  it('탭의 반보다 오른쪽이면 그 탭 뒤다', () => {
    expect(dropIndexAt(boxes, 60)).toBe(1)
    expect(dropIndexAt(boxes, 160)).toBe(2)
  })

  it('마지막 탭 오른쪽 끝이면 맨 뒤(= 탭 수)', () => {
    expect(dropIndexAt(boxes, 280)).toBe(3)
    expect(dropIndexAt(boxes, 9999)).toBe(3)
  })

  it('줄이 비어 있으면 0', () => {
    expect(dropIndexAt([], 100)).toBe(0)
  })
})

describe('insertTab — 다른 창에서 건너온 탭을 끼운다', () => {
  it('가운데에 끼우고, 끼운 탭이 활성이 된다', () => {
    const got = insertTab(set('a', 'b'), loc('api', 'studio'), 1)
    expect(got.tabs.map((t) => t.serviceId)).toEqual(['db', 'api', 'db'])
    expect(activeTab(got)).toMatchObject(loc('api', 'studio'))
  })

  it('탭 수와 같은 번호면 맨 뒤', () => {
    const got = insertTab(set('a', 'b'), loc('api', 'studio'), 2)
    expect(got.tabs[2].serviceId).toBe('api')
  })

  it('범위를 벗어난 번호는 양 끝으로 조인다', () => {
    expect(insertTab(set('a', 'b'), loc('api', 'studio'), -5).tabs[0].serviceId).toBe('api')
    expect(insertTab(set('a', 'b'), loc('api', 'studio'), 99).tabs[2].serviceId).toBe('api')
  })

  it('id 는 쓰이지 않는 번호로 새로 짓는다 — 건너온 탭의 id 를 물려받지 않는다', () => {
    const got = insertTab({ tabs: [{ id: 't1', ...loc('db', 'x'), context: {} }], activeTabId: 't1' }, loc('api', 'studio'), 1)
    expect(got.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})

describe('toSession · fromSession — 메인과 주고받는 모양', () => {
  it('접었다 펴면 순서와 활성이 그대로다', () => {
    const before: TabSet = {
      tabs: [
        { id: 'a', ...loc('db', 'remote', 'collections'), context: {} },
        { id: 'b', ...loc('api', 'studio'), context: {} }
      ],
      activeTabId: 'b'
    }
    const after = fromSession(toSession(before))
    expect(after.tabs.map((t) => t.serviceId)).toEqual(['db', 'api'])
    expect(activeTab(after)).toMatchObject(loc('api', 'studio'))
  })

  it('id 는 안 보낸다 — 창을 다시 열 때 새로 짓는다', () => {
    const s = toSession({ tabs: [{ id: 'zz', ...loc('db', 'remote'), context: {} }], activeTabId: 'zz' })
    expect(s.tabs[0]).toEqual({ ...loc('db', 'remote'), context: {} })
    expect(fromSession(s).tabs[0].id).toBe('t1')
  })

  it('활성 탭이 목록에 없으면 첫 탭을 활성으로 보낸다', () => {
    const s = toSession({ tabs: [{ id: 'a', ...loc('db', 'remote'), context: {} }], activeTabId: '없음' })
    expect(s.active).toBe(0)
  })

  it('탭마다의 대상을 실어 보내고 되받는다 — 껐다 켜도 탭별로 돌아온다', () => {
    const before: TabSet = {
      tabs: [
        { id: 'a', ...loc('db', 'remote'), context: { conn: 'c1' } },
        { id: 'b', ...loc('db', 'remote'), context: { conn: 'c2' } }
      ],
      activeTabId: 'a'
    }
    const after = fromSession(toSession(before))
    expect(after.tabs.map((t) => t.context.conn)).toEqual(['c1', 'c2'])
  })
})

describe('탭별 대상 격리 — 2026-08-07 결정', () => {
  it('`+` 로 연 탭은 보던 대상을 물려받는다', () => {
    const before: TabSet = {
      tabs: [{ id: 't1', ...loc('db', 'remote'), context: { conn: 'c1' } }],
      activeTabId: 't1'
    }
    expect(activeTab(openTab(before, activeTab(before))).context).toEqual({ conn: 'c1' })
  })

  it('물려받은 대상은 **사본**이다 — 한쪽에서 고쳐도 원래 탭이 안 따라간다', () => {
    const before: TabSet = {
      tabs: [{ id: 't1', ...loc('db', 'remote'), context: { conn: 'c1' } }],
      activeTabId: 't1'
    }
    const after = openTab(before, activeTab(before))
    activeTab(after).context.conn = 'c2'
    expect(after.tabs[0].context.conn).toBe('c1')
  })

  it('자리를 옮겨도 그 탭의 대상은 그대로다 — 서비스·모듈 이동이 선택을 지우지 않는다', () => {
    const before: TabSet = {
      tabs: [{ id: 't1', ...loc('db', 'remote'), context: { conn: 'c1' } }],
      activeTabId: 't1'
    }
    expect(activeTab(moveActiveTab(before, loc('db', 'migration'))).context).toEqual({ conn: 'c1' })
  })

  it('건너온 탭도 제 대상을 들고 끼워진다 — 떼어낸 창이 보던 접속을 문다', () => {
    const got = insertTab(set('a', 'b'), { ...loc('api', 'studio'), context: { spec: 's1' } }, 1)
    expect(got.tabs[1].context).toEqual({ spec: 's1' })
  })
})

/** 탭 두 장에 서로 다른 접속을 물린 묶음 — 격리를 보는 테스트들의 출발점. */
function twoConns(): TabSet {
  return {
    tabs: [
      { id: 't1', ...loc('db', 'remote'), context: { conn: 'c1' } },
      { id: 't2', ...loc('db', 'remote'), context: { conn: 'c2' } }
    ],
    activeTabId: 't1'
  }
}

describe('setActiveContext — 대상은 활성 탭에만 걸린다', () => {
  it('다른 탭의 선택을 안 건드린다 — 이게 2026-08-07 요청의 핵심이다', () => {
    const got = setActiveContext(twoConns(), (c) => ({ ...c, conn: 'c9' }))
    expect(got.tabs.map((t) => t.context.conn)).toEqual(['c9', 'c2'])
  })

  it('바뀐 게 없으면 같은 묶음을 그대로 — 구독자가 헛돌지도, 메인에 되보고가 나가지도 않는다', () => {
    const before = twoConns()
    expect(setActiveContext(before, (c) => ({ ...c }))).toBe(before)
    expect(setActiveContext(before, (c) => ({ ...c, conn: 'c1' }))).toBe(before)
  })

  it('아직 안 고른 셀렉터에만 기본값을 채우는 쓰임 — 이미 고른 것은 안 덮는다', () => {
    const got = setActiveContext(twoConns(), (c) => ({ conn: 'default', env: 'dev', ...c }))
    expect(activeTab(got).context).toEqual({ conn: 'c1', env: 'dev' })
  })
})

describe('clearContextEverywhere — 남아 있으면 안 되는 선택 풀기', () => {
  it('값을 안 주면 모든 탭에서 푼다 — 앱을 켤 때 환경 선택이 그렇다', () => {
    const got = clearContextEverywhere(twoConns(), 'conn')
    expect(got.tabs.map((t) => t.context)).toEqual([{}, {}])
  })

  it('값을 주면 그 값을 고른 탭만 — 남의 선택까지 지우지 않는다', () => {
    const got = clearContextEverywhere(twoConns(), 'conn', 'c2')
    expect(got.tabs.map((t) => t.context.conn)).toEqual(['c1', undefined])
  })

  it('풀 것이 없으면 같은 묶음을 그대로', () => {
    const before = twoConns()
    expect(clearContextEverywhere(before, 'env')).toBe(before)
    expect(clearContextEverywhere(before, 'conn', '없음')).toBe(before)
  })
})

describe('keepContextWithin — 고를 수 없게 된 선택 놓기', () => {
  it('허용 목록 밖을 고른 탭만 놓는다 — 프로젝트를 옮기면 남의 것이 남으면 안 된다', () => {
    const got = keepContextWithin(twoConns(), 'conn', new Set(['c1']))
    expect(got.tabs.map((t) => t.context.conn)).toEqual(['c1', undefined])
  })

  it('다 허용되면 같은 묶음을 그대로', () => {
    const before = twoConns()
    expect(keepContextWithin(before, 'conn', new Set(['c1', 'c2']))).toBe(before)
  })

  it('아직 안 고른 탭은 안 건드린다 — 못 고르게 된 것과 결과가 같다', () => {
    const before = set('t1', 't2')
    expect(keepContextWithin(before, 'conn', new Set())).toBe(before)
  })

  it('다른 셀렉터는 안 건드린다', () => {
    const s: TabSet = {
      tabs: [{ id: 't1', ...loc('db', 'remote'), context: { conn: 'c1', design: 'd1' } }],
      activeTabId: 't1'
    }
    expect(activeTab(keepContextWithin(s, 'conn', new Set())).context).toEqual({ design: 'd1' })
  })
})

describe('seedContext — 옛 저장본(창에 하나였던 선택) 옮겨 심기', () => {
  it('아무 탭도 대상이 없으면 전부에 심는다', () => {
    const got = seedContext(set('t1', 't2'), { conn: 'c1' })
    expect(got.tabs.map((t) => t.context.conn)).toEqual(['c1', 'c1'])
  })

  it('심은 값은 탭마다 **사본**이다 — 한 탭에서 고치면 다른 탭이 따라가면 안 된다', () => {
    const got = seedContext(set('t1', 't2'), { conn: 'c1' })
    got.tabs[0].context.conn = 'c9'
    expect(got.tabs[1].context.conn).toBe('c1')
  })

  it('대상을 이미 든 탭이 있으면 통째로 안 건드린다 — 떼어낸 창이 물고 온 것을 덮지 않는다', () => {
    const before = twoConns()
    expect(seedContext(before, { conn: 'c-옛것' })).toBe(before)
  })

  it('심을 것이 없으면 그대로', () => {
    const before = set('t1')
    expect(seedContext(before, {})).toBe(before)
  })
})

describe('tabTitle', () => {
  const icon = (() => null) as unknown as Module['icon']
  const module = { id: 'remote', label: 'Remote', icon } as Module
  const view = { id: 'collections', label: 'Collections', icon } as View

  it('뷰가 있으면 모듈 · 뷰', () => {
    expect(tabTitle(module, view)).toBe('Remote · Collections')
  })

  it('뷰가 없으면 모듈 이름만', () => {
    expect(tabTitle(module, null)).toBe('Remote')
  })
})

describe('normalizeTabSet — 저장본 걸러 받기', () => {
  it('배열이 아니거나 살릴 게 없으면 null', () => {
    expect(normalizeTabSet(undefined, undefined)).toBeNull()
    expect(normalizeTabSet([], 't1')).toBeNull()
    expect(normalizeTabSet([{ id: '' }, null, 3], 't1')).toBeNull()
  })

  it('모양이 어긋난 항목만 버리고 나머지는 살린다', () => {
    const s = normalizeTabSet(
      [{ id: 't1', serviceId: 'db', moduleId: 'remote', viewId: 'collections' }, { id: 't2' }],
      't1'
    )
    expect(s?.tabs).toEqual([
      { id: 't1', serviceId: 'db', moduleId: 'remote', viewId: 'collections', context: {} }
    ])
  })

  it('id 가 겹치면 뒤엣것을 버린다 — 겹치면 눌러도 늘 앞엣것만 켜진다', () => {
    const s = normalizeTabSet(
      [
        { id: 't1', serviceId: 'db', moduleId: 'remote', viewId: null },
        { id: 't1', serviceId: 'api', moduleId: 'studio', viewId: null }
      ],
      't1'
    )
    expect(s?.tabs).toHaveLength(1)
    expect(s?.tabs[0].serviceId).toBe('db')
  })

  it('활성 id 가 목록에 없으면 첫 탭으로 되돌린다', () => {
    const s = normalizeTabSet([{ id: 't1', serviceId: 'db', moduleId: '', viewId: null }], 't9')
    expect(s?.activeTabId).toBe('t1')
  })

  it('"첫 모듈" 표현인 빈 모듈 id 를 버리지 않는다', () => {
    const s = normalizeTabSet([{ id: 't1', serviceId: 'db', moduleId: '', viewId: null }], 't1')
    expect(s?.tabs[0].moduleId).toBe('')
  })
})
