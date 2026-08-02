import { describe, expect, it } from 'vitest'
import { isActive, pruned, withActive, type ActivityMap } from './agentActivity'

const TTL = 6_000

describe('에이전트 활동 표시 — 언제 켜지고 언제 꺼지나', () => {
  it('찍은 서비스만 켜진다', () => {
    const map = withActive({}, 'uiux', 1_000)
    expect(isActive(map, 'uiux', 1_000, TTL)).toBe(true)
    expect(isActive(map, 'db', 1_000, TTL)).toBe(false)
  })

  it('TTL 이 지나면 꺼진다 — 경계는 열려 있다(딱 TTL 이면 꺼짐)', () => {
    const map = withActive({}, 'uiux', 1_000)
    expect(isActive(map, 'uiux', 1_000 + TTL - 1, TTL)).toBe(true)
    expect(isActive(map, 'uiux', 1_000 + TTL, TTL)).toBe(false)
  })

  it('같은 서비스를 다시 찍으면 시각이 밀린다 — 연속 쓰기 중에 점이 깜빡이지 않는다', () => {
    const first = withActive({}, 'uiux', 1_000)
    const second = withActive(first, 'uiux', 5_000)
    expect(isActive(second, 'uiux', 10_000, TTL)).toBe(true)
    expect(Object.keys(second)).toHaveLength(1)
  })

  it('여러 서비스가 동시에 켜진다 — 에이전트가 DB 와 UI/UX 를 잇달아 고칠 수 있다', () => {
    const map = withActive(withActive({}, 'db', 1_000), 'uiux', 1_200)
    expect(isActive(map, 'db', 2_000, TTL)).toBe(true)
    expect(isActive(map, 'uiux', 2_000, TTL)).toBe(true)
  })

  it('pruned — 만료된 것만 턴다', () => {
    const map = withActive(withActive({}, 'db', 1_000), 'uiux', 5_000)
    const out = pruned(map, 8_000, TTL)
    expect(Object.keys(out)).toEqual(['uiux'])
  })

  it('pruned — 다 살아 있으면 같은 객체를 돌려준다(헛 렌더 방지)', () => {
    const map: ActivityMap = withActive({}, 'uiux', 1_000)
    expect(pruned(map, 2_000, TTL)).toBe(map)
  })

  it('pruned — 다 만료됐으면 빈 지도', () => {
    const map = withActive(withActive({}, 'db', 1_000), 'uiux', 1_000)
    expect(pruned(map, 99_000, TTL)).toEqual({})
  })
})
