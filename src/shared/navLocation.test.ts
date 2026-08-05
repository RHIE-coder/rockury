import { describe, expect, it } from 'vitest'
import { decodeNavLocation, encodeNavLocation } from './navLocation'

describe('navLocation — 자리 표기', () => {
  it('뷰가 있으면 세 토막, 없으면 두 토막', () => {
    expect(encodeNavLocation({ serviceId: 'db', moduleId: 'remote', viewId: 'collections' })).toBe(
      'db/remote/collections'
    )
    expect(encodeNavLocation({ serviceId: 'ai', moduleId: 'agents', viewId: null })).toBe('ai/agents')
  })

  it('접었다 펴면 그대로다', () => {
    const loc = { serviceId: 'db', moduleId: 'migration', viewId: 'plan' }
    expect(decodeNavLocation(encodeNavLocation(loc))).toEqual(loc)
  })

  it('"첫 모듈" 표현인 빈 모듈 id 를 살려 낸다', () => {
    // useNav 는 아직 아무것도 안 누른 상태의 모듈을 '' 로 둔다 — 그 자리도 창으로 넘어가야 한다.
    expect(decodeNavLocation('db/')).toEqual({ serviceId: 'db', moduleId: '', viewId: null })
  })

  it('모양이 어긋나면 null 이다 — 주소는 사용자가 손댈 수 있다', () => {
    expect(decodeNavLocation(null)).toBeNull()
    expect(decodeNavLocation('')).toBeNull()
    expect(decodeNavLocation('db')).toBeNull()
    expect(decodeNavLocation('db/remote/collections/extra')).toBeNull()
    expect(decodeNavLocation('db/../etc/passwd')).toBeNull()
    expect(decodeNavLocation('db/remote/coll ections')).toBeNull()
    expect(decodeNavLocation('/remote/collections')).toBeNull()
  })
})
