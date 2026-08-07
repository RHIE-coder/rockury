import { describe, expect, it } from 'vitest'
import { MAX_WINDOWS, normalizeWindowStore } from './windowStore'

/** 탭 하나. `context`(그 탭이 고른 대상)는 안 주면 빈 것으로 정규화된다. */
const loc = (serviceId: string, moduleId: string, viewId: string | null = null) => ({
  serviceId,
  moduleId,
  viewId,
  context: {}
})
const bounds = { x: 10, y: 20, width: 1200, height: 800 }

describe('normalizeWindowStore — 창 배치 저장본 걸러 받기', () => {
  it('성한 저장본을 그대로 살린다', () => {
    const saved = { windows: [{ tabs: [loc('db', 'remote', 'collections')], active: 0, bounds }] }
    expect(normalizeWindowStore(saved)).toEqual([
      { tabs: [loc('db', 'remote', 'collections')], active: 0, bounds }
    ])
  })

  it('모양이 아니면 빈 배열 — 부르는 쪽이 기본 창 하나를 연다', () => {
    expect(normalizeWindowStore(null)).toEqual([])
    expect(normalizeWindowStore('nope')).toEqual([])
    expect(normalizeWindowStore({})).toEqual([])
    expect(normalizeWindowStore({ windows: 'nope' })).toEqual([])
  })

  it('탭이 하나도 안 성한 창은 버린다', () => {
    const saved = { windows: [{ tabs: [{ serviceId: 42 }], active: 0, bounds }, { tabs: [], active: 0, bounds }] }
    expect(normalizeWindowStore(saved)).toEqual([])
  })

  it('창 자리가 깨졌어도 탭은 살린다 — 자리는 다시 계산되지만 탭은 못 되살린다', () => {
    const saved = { windows: [{ tabs: [loc('db', 'remote')], active: 0, bounds: { x: 'a' } }] }
    const got = normalizeWindowStore(saved)
    expect(got).toHaveLength(1)
    expect(got[0].tabs).toEqual([loc('db', 'remote')])
    expect(got[0].bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('창이 터무니없이 많으면 잘라 낸다 — 부팅하자마자 창 수십 개는 끄기도 어렵다', () => {
    const one = { tabs: [loc('db', 'remote')], active: 0, bounds }
    const saved = { windows: Array.from({ length: 40 }, () => one) }
    expect(normalizeWindowStore(saved)).toHaveLength(MAX_WINDOWS)
  })

  it('"첫 모듈" 표현인 빈 모듈 id 는 성한 값이다', () => {
    const saved = { windows: [{ tabs: [loc('db', '')], active: 0, bounds }] }
    expect(normalizeWindowStore(saved)[0].tabs).toEqual([loc('db', '')])
  })

  it('활성 번호가 범위를 벗어나면 첫 탭으로 되돌린다', () => {
    const saved = { windows: [{ tabs: [loc('db', 'remote')], active: 9, bounds }] }
    expect(normalizeWindowStore(saved)[0].active).toBe(0)
  })

  it('탭마다 고른 대상을 살린다 — 껐다 켜도 탭별 접속이 돌아온다', () => {
    const saved = {
      windows: [
        {
          tabs: [
            { serviceId: 'db', moduleId: 'remote', viewId: null, context: { conn: 'c1' } },
            { serviceId: 'db', moduleId: 'remote', viewId: null, context: { conn: 'c2' } }
          ],
          active: 1,
          bounds
        }
      ]
    }
    expect(normalizeWindowStore(saved)[0].tabs.map((t) => t.context?.conn)).toEqual(['c1', 'c2'])
  })

  it('대상이 없던 옛 저장본도 성하다 — 빈 것으로 채운다', () => {
    const saved = { windows: [{ tabs: [{ serviceId: 'db', moduleId: 'remote', viewId: null }], active: 0, bounds }] }
    expect(normalizeWindowStore(saved)[0].tabs[0].context).toEqual({})
  })
})
