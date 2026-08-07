import { describe, expect, it } from 'vitest'
import { decodeWindowBoot, encodeWindowBoot, normalizeContext, normalizeSession } from './windowSession'

/** 탭 하나. `context`(그 탭이 고른 대상)는 안 주면 빈 것으로 정규화된다. */
const loc = (serviceId: string, moduleId: string, viewId: string | null = null) => ({
  serviceId,
  moduleId,
  viewId,
  context: {}
})

describe('windowSession — 창이 들고 나오는 것', () => {
  it('접었다 펴면 그대로다', () => {
    const boot = {
      primary: true,
      session: { tabs: [loc('db', 'remote', 'collections'), loc('ai', 'agents')], active: 1 }
    }
    expect(decodeWindowBoot([encodeWindowBoot(boot)])).toEqual(boot)
  })

  it('다른 실행 인자에 섞여 있어도 찾아낸다', () => {
    const arg = encodeWindowBoot({ primary: false, session: { tabs: [loc('api', 'studio')], active: 0 } })
    const got = decodeWindowBoot(['/path/main.js', '--user-data-dir=/tmp/x', arg, '--other'])
    expect(got?.primary).toBe(false)
    expect(got?.session.tabs).toEqual([loc('api', 'studio')])
  })

  it('인자가 없으면 null — 첫 창을 기본 자리로 연다는 뜻', () => {
    expect(decodeWindowBoot([])).toBeNull()
    expect(decodeWindowBoot(['--user-data-dir=/tmp/x'])).toBeNull()
  })

  it('깨진 인자는 null 로 떨어진다 — 앱이 안 뜨는 것보다 기본 자리가 낫다', () => {
    expect(decodeWindowBoot(['--rockury-window=%%%not-base64%%%'])).toBeNull()
    expect(decodeWindowBoot(['--rockury-window='])).toBeNull()
  })

  it('탭이 하나도 안 살아남으면 null', () => {
    expect(normalizeSession({ tabs: [null, null], active: 0 })).toBeNull()
    expect(normalizeSession({ tabs: [], active: 0 })).toBeNull()
  })

  it('활성 번호가 범위를 벗어나면 첫 탭으로 되돌린다', () => {
    expect(normalizeSession({ tabs: [loc('db', 'remote')], active: 7 })?.active).toBe(0)
    expect(normalizeSession({ tabs: [loc('db', 'remote')], active: -1 })?.active).toBe(0)
    expect(normalizeSession({ tabs: [loc('db', 'remote')], active: 1.5 })?.active).toBe(0)
  })

  it('깨진 탭은 버리고 성한 것만 살린다', () => {
    const s = normalizeSession({ tabs: [null, loc('db', 'remote'), null], active: 0 })
    expect(s?.tabs).toEqual([loc('db', 'remote')])
  })

  it('탭마다의 대상을 실행 인자에 실어 보낸다 — 떼어낸 창이 보던 접속을 물고 열린다', () => {
    const boot = {
      primary: false,
      session: {
        tabs: [
          { ...loc('db', 'remote'), context: { conn: 'c1' } },
          { ...loc('db', 'remote'), context: { conn: 'c2' } }
        ],
        active: 0
      }
    }
    expect(decodeWindowBoot([encodeWindowBoot(boot)])).toEqual(boot)
  })

  it('대상 선택이 없는 옛 인자도 성하다 — 빈 것으로 편다', () => {
    const raw = encodeWindowBoot({ primary: true, session: { tabs: [loc('db', 'remote')], active: 0 } })
    expect(decodeWindowBoot([raw])?.session.tabs[0].context).toEqual({})
  })

  it('탭이 터무니없이 많으면 잘라 낸다 — 깨진 저장본이 창을 못 그리게 되는 것 방지', () => {
    const many = Array.from({ length: 500 }, () => loc('db', 'remote'))
    expect(normalizeSession({ tabs: many, active: 0 })?.tabs.length).toBe(60)
  })
})

describe('normalizeContext — 탭이 고른 대상 걸러 받기', () => {
  it('문자열 짝만 살린다 — 저장본이 깨져도 화면이 이상한 값을 고른 것처럼 보이지 않게', () => {
    expect(normalizeContext({ conn: 'c1', design: 42, spec: null, env: 's' })).toEqual({
      conn: 'c1',
      env: 's'
    })
  })

  it('모양이 아니면 빈 것', () => {
    expect(normalizeContext(null)).toEqual({})
    expect(normalizeContext('nope')).toEqual({})
    expect(normalizeContext(['conn', 'c1'])).toEqual({})
  })

  it('터무니없이 많거나 긴 값은 잘라 낸다', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 'v']))
    expect(Object.keys(normalizeContext(many)).length).toBe(20)
    expect(normalizeContext({ conn: 'x'.repeat(500) })).toEqual({})
  })
})
