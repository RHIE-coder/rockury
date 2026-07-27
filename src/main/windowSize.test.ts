import { describe, expect, it } from 'vitest'
import {
  defaultWindowBounds,
  defaultWindowSize,
  WINDOW_ASPECT,
  WINDOW_MAX,
  WINDOW_MIN
} from './windowSize'

describe('defaultWindowSize — 첫 창 크기', () => {
  it('보통 화면에서는 작업영역의 90%', () => {
    expect(defaultWindowSize({ width: 1680, height: 1050 })).toEqual({ width: 1512, height: 945 })
  })

  it('초광폭 화면에서도 상한을 넘지 않는다', () => {
    const s = defaultWindowSize({ width: 5120, height: 2160 })
    expect(s.width).toBe(WINDOW_MAX.width)
    expect(s.height).toBe(WINDOW_MAX.height)
  })

  it('작은 화면에서는 하한까지 키운다(90% 보다 크게)', () => {
    const s = defaultWindowSize({ width: 1200, height: 800 })
    expect(s).toEqual({ width: WINDOW_MIN.width, height: WINDOW_MIN.height })
  })

  it('하한보다도 좁은 화면이면 창이 화면 밖으로 나가지 않는다', () => {
    const work = { width: 1024, height: 640 }
    const s = defaultWindowSize(work)
    expect(s.width).toBeLessThanOrEqual(work.width)
    expect(s.height).toBeLessThanOrEqual(work.height)
  })

  it('예전 고정 크기(1320×840)보다는 크다 — 이번 변경의 목적', () => {
    const s = defaultWindowSize({ width: 1728, height: 1117 })
    expect(s.width).toBeGreaterThan(1320)
    expect(s.height).toBeGreaterThan(840)
  })

  it('정사각형에 가까운 화면에서도 창은 가로로 넓다 — 회귀', () => {
    const s = defaultWindowSize({ width: 1440, height: 1440 })
    expect(s).toEqual({ width: 1296, height: 810 })
    expect(s.width / s.height).toBeCloseTo(WINDOW_ASPECT, 2)
  })

  it('세로로 긴 화면에서도 세로가 가로보다 길어지지 않는다', () => {
    const s = defaultWindowSize({ width: 1080, height: 1920 })
    expect(s.width).toBeGreaterThan(s.height)
    expect(s.width).toBeLessThanOrEqual(1080)
  })

  it('충분히 큰 화면이면 16:10 비를 지킨다', () => {
    for (const work of [
      { width: 2560, height: 1440 },
      { width: 1728, height: 1117 },
      { width: 3840, height: 2160 }
    ]) {
      const s = defaultWindowSize(work)
      expect(s.width / s.height).toBeCloseTo(WINDOW_ASPECT, 2)
    }
  })
})

describe('defaultWindowBounds — 첫 창 위치', () => {
  it('지정한 화면 안에서 중앙에 놓는다', () => {
    const b = defaultWindowBounds({ x: 0, y: 40, width: 1800, height: 1129 })
    expect(b).toEqual({ x: 90, y: 98, width: 1620, height: 1013 })
  })

  it('원점이 음수인 화면(주 모니터 왼쪽·위)에서도 그 화면 안에 들어간다', () => {
    const work = { x: -760, y: -1409, width: 2560, height: 1409 }
    const b = defaultWindowBounds(work)
    expect(b.x).toBeGreaterThanOrEqual(work.x)
    expect(b.y).toBeGreaterThanOrEqual(work.y)
    expect(b.x + b.width).toBeLessThanOrEqual(work.x + work.width)
    expect(b.y + b.height).toBeLessThanOrEqual(work.y + work.height)
  })

  it('세로 모니터에 띄워도 창이 그 화면 폭을 넘지 않는다 — 잘려서 정사각형이 되던 회귀', () => {
    const work = { x: 1800, y: -1708, width: 1080, height: 1889 }
    const b = defaultWindowBounds(work)
    expect(b.width).toBeLessThanOrEqual(work.width)
    expect(b.x).toBeGreaterThanOrEqual(work.x)
    expect(b.x + b.width).toBeLessThanOrEqual(work.x + work.width)
    expect(b.width).toBeGreaterThan(b.height)
  })
})
