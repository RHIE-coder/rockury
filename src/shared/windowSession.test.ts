import { describe, expect, it } from 'vitest'
import { decodeWindowBoot, encodeWindowBoot, normalizeSession } from './windowSession'

const loc = (serviceId: string, moduleId: string, viewId: string | null = null) => ({
  serviceId,
  moduleId,
  viewId
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

  it('탭이 터무니없이 많으면 잘라 낸다 — 깨진 저장본이 창을 못 그리게 되는 것 방지', () => {
    const many = Array.from({ length: 500 }, () => loc('db', 'remote'))
    expect(normalizeSession({ tabs: many, active: 0 })?.tabs.length).toBe(60)
  })
})
