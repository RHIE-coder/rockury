import { describe, expect, it } from 'vitest'
import { Boxes } from 'lucide-react'
import { areasIn, groupBySlot, handlesFor, isAreaSplit } from './moduleSlots'
import type { Module } from './types'

const mod = (id: string, extra: Partial<Module> = {}): Module => ({
  id,
  label: id,
  icon: Boxes,
  ...extra
})

describe('groupBySlot', () => {
  // 자리를 안 쓰는 네 서비스(uiux·api·infra·ai)가 여기 걸린다 — 예전 그대로여야 한다.
  it('자리를 안 적으면 전부 왼쪽에, 등록 순서 그대로', () => {
    const zones = groupBySlot([mod('a'), mod('b'), mod('c')])
    expect(zones.start.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(zones.center).toEqual([])
    expect(zones.end).toEqual([])
  })

  it('자리별로 갈라 담고, 자리 안의 순서는 등록 순서다', () => {
    const zones = groupBySlot([
      mod('design'),
      mod('remote', { slot: 'end' }),
      mod('reference'),
      mod('migration', { slot: 'center' })
    ])
    expect(zones.start.map((m) => m.id)).toEqual(['design', 'reference'])
    expect(zones.center.map((m) => m.id)).toEqual(['migration'])
    expect(zones.end.map((m) => m.id)).toEqual(['remote'])
  })
})

describe('areasIn', () => {
  it('처음 나온 순서로, 중복 없이', () => {
    expect(
      areasIn([
        mod('a', { area: 'design' }),
        mod('b', { area: 'design' }),
        mod('c', { area: 'common' }),
        mod('d', { area: 'ops' })
      ])
    ).toEqual(['design', 'common', 'ops'])
  })

  it('구획을 안 적으면 common', () => {
    expect(areasIn([mod('a')])).toEqual(['common'])
  })
})

describe('handlesFor', () => {
  // 손잡이가 맨 위 줄에서 뷰 탭 줄로 내려오면서 생긴 규칙(2026-08-02). 눈으로만 보이는 종류라
  // 타입검사·빌드가 못 잡는다 — 여기서 어긋나면 화면에 대상 고르는 자리가 통째로 없어진다.
  it('구획을 가진 모듈은 자기 구획 손잡이 하나를 든다', () => {
    expect(handlesFor(mod('design', { area: 'design' }))).toEqual(['design'])
    expect(handlesFor(mod('remote', { area: 'ops' }))).toEqual(['ops'])
  })

  it('공통 모듈은 손잡이가 없다 — 어느 부서의 대상도 안 쓴다(DB 의 Reference)', () => {
    expect(handlesFor(mod('reference', { area: 'common' }))).toEqual([])
  })

  it('구획을 안 적어도 손잡이가 없다 — 구획을 안 쓰는 서비스에 빈 테두리가 안 생긴다', () => {
    expect(handlesFor(mod('screens'))).toEqual([])
  })

  it('직접 적으면 그대로다 — 두 부서를 견주는 모듈(Migration)이 둘 다 든다', () => {
    expect(handlesFor(mod('migration', { area: 'common', handles: ['design', 'ops'] }))).toEqual([
      'design',
      'ops'
    ])
  })

  it('직접 적은 것이 자기 구획을 이긴다 — 예외를 적었는데 기본값이 덮으면 적은 뜻이 없다', () => {
    expect(handlesFor(mod('x', { area: 'ops', handles: [] }))).toEqual([])
  })
})

describe('isAreaSplit', () => {
  // 구획을 안 쓰는 네 서비스(uiux·api·infra·ai)의 활성 탭 색이 조용히 바뀌지 않게 하는 가드.
  it('구획을 안 쓰는 서비스는 갈리지 않았다', () => {
    expect(isAreaSplit([mod('a'), mod('b'), mod('c', { area: 'common' })])).toBe(false)
  })

  it('설계부/운영부가 있으면 갈렸다', () => {
    expect(isAreaSplit([mod('design', { area: 'design' }), mod('remote', { area: 'ops' })])).toBe(true)
  })

  it('모듈이 없으면 갈리지 않았다', () => {
    expect(isAreaSplit([])).toBe(false)
  })
})
