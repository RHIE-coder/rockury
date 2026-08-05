import { describe, expect, it } from 'vitest'
import {
  activeTab,
  closeTab,
  detachTab,
  droppedOutside,
  fromSession,
  moveActiveTab,
  moveTab,
  nextTabId,
  normalizeTabSet,
  openTab,
  selectTab,
  selectTabAt,
  stepTab,
  tabTitle,
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
    tabs: ids.map((id) => ({ id, ...loc('db', id) })),
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
    let s: TabSet = { tabs: [{ id: 't1', ...loc('db', 'remote') }], activeTabId: 't1' }
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
    const before: TabSet = { tabs: [{ id: 't1', ...loc('db', 'remote', 'collections') }], activeTabId: 't1' }
    const after = openTab(before, activeTab(before))
    expect(after.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(after.activeTabId).toBe('t2')
    expect(after.tabs[1]).toEqual({ id: 't2', ...loc('db', 'remote', 'collections') })
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
    const s = { tabs: [{ id: 't1', ...loc('db', 'remote', 'collections') }], activeTabId: 't1' }
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

describe('droppedOutside — 창 밖에 놓았나', () => {
  // 화면 (100,100) 에 놓인 1000×800 창.
  const frame = { screenX: 100, screenY: 100, outerWidth: 1000, outerHeight: 800 }

  it('창 안에 놓으면 아니다 (자리 옮기기다)', () => {
    expect(droppedOutside({ screenX: 400, screenY: 300 }, frame)).toBe(false)
    expect(droppedOutside({ screenX: 100, screenY: 100 }, frame)).toBe(false)
    expect(droppedOutside({ screenX: 1100, screenY: 900 }, frame)).toBe(false)
  })

  it('네 방향 어디로든 벗어나면 맞다', () => {
    expect(droppedOutside({ screenX: 99, screenY: 300 }, frame)).toBe(true)
    expect(droppedOutside({ screenX: 400, screenY: 99 }, frame)).toBe(true)
    expect(droppedOutside({ screenX: 1101, screenY: 300 }, frame)).toBe(true)
    expect(droppedOutside({ screenX: 400, screenY: 901 }, frame)).toBe(true)
  })

  it('취소된 끌기(0,0)는 창 밖으로 안 친다 — 취소했는데 탭이 떨어져 나가면 안 된다', () => {
    expect(droppedOutside({ screenX: 0, screenY: 0 }, frame)).toBe(false)
  })
})

describe('toSession · fromSession — 메인과 주고받는 모양', () => {
  it('접었다 펴면 순서와 활성이 그대로다', () => {
    const before: TabSet = {
      tabs: [
        { id: 'a', ...loc('db', 'remote', 'collections') },
        { id: 'b', ...loc('api', 'studio') }
      ],
      activeTabId: 'b'
    }
    const after = fromSession(toSession(before))
    expect(after.tabs.map((t) => t.serviceId)).toEqual(['db', 'api'])
    expect(activeTab(after)).toMatchObject(loc('api', 'studio'))
  })

  it('id 는 안 보낸다 — 창을 다시 열 때 새로 짓는다', () => {
    const s = toSession({ tabs: [{ id: 'zz', ...loc('db', 'remote') }], activeTabId: 'zz' })
    expect(s.tabs[0]).toEqual(loc('db', 'remote'))
    expect(fromSession(s).tabs[0].id).toBe('t1')
  })

  it('활성 탭이 목록에 없으면 첫 탭을 활성으로 보낸다', () => {
    const s = toSession({ tabs: [{ id: 'a', ...loc('db', 'remote') }], activeTabId: '없음' })
    expect(s.active).toBe(0)
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
    expect(s?.tabs).toEqual([{ id: 't1', serviceId: 'db', moduleId: 'remote', viewId: 'collections' }])
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
