import { describe, expect, it } from 'vitest'
import {
  CASCADE_STEP,
  cascadeBounds,
  defaultWindowBounds,
  defaultWindowSize,
  WINDOW_ASPECT,
  usableBounds,
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

describe('cascadeBounds — 둘째 창부터의 위치', () => {
  const work = { x: 0, y: 40, width: 1800, height: 1129 }
  const base = defaultWindowBounds(work)

  it('첫 창은 계산된 자리 그대로다', () => {
    expect(cascadeBounds(base, work, 0)).toEqual(base)
  })

  it('다음 창마다 오른아래로 한 걸음씩 민다', () => {
    expect(cascadeBounds(base, work, 1)).toEqual({
      ...base,
      x: base.x + CASCADE_STEP,
      y: base.y + CASCADE_STEP
    })
    expect(cascadeBounds(base, work, 2).x).toBe(base.x + CASCADE_STEP * 2)
  })

  it('밀어도 창은 늘 작업영역 안에 있다 — 화면 밖에 열려 안 보이는 사고 방지', () => {
    for (let i = 0; i < 40; i++) {
      const b = cascadeBounds(base, work, i)
      expect(b.x).toBeGreaterThanOrEqual(work.x)
      expect(b.y).toBeGreaterThanOrEqual(work.y)
      expect(b.x + b.width).toBeLessThanOrEqual(work.x + work.width)
      expect(b.y + b.height).toBeLessThanOrEqual(work.y + work.height)
    }
  })

  it('끝까지 밀면 처음 자리로 되감는다', () => {
    const room = Math.min(
      work.x + work.width - base.width - base.x,
      work.y + work.height - base.height - base.y
    )
    const steps = Math.floor(room / CASCADE_STEP)
    expect(cascadeBounds(base, work, steps + 1)).toEqual(base)
  })

  it('밀 자리가 아예 없는 화면(창이 작업영역을 꽉 채움)에서는 안 민다', () => {
    const tight = { x: 0, y: 0, width: base.width, height: base.height }
    expect(cascadeBounds({ ...base, x: 0, y: 0 }, tight, 3)).toEqual({ ...base, x: 0, y: 0 })
  })

  it('크기는 안 건드린다 — 미는 것은 위치뿐', () => {
    const b = cascadeBounds(base, work, 5)
    expect(b.width).toBe(base.width)
    expect(b.height).toBe(base.height)
  })
})

describe('usableBounds — 저장해 둔 창 자리를 지금 화면에 비춰 보기', () => {
  const main = { x: 0, y: 40, width: 1800, height: 1129 }
  const second = { x: 1800, y: 0, width: 1920, height: 1080 }

  it('그 화면이 그대로 있으면 저장된 자리를 살린다', () => {
    const saved = { x: 100, y: 100, width: 1200, height: 800 }
    expect(usableBounds(saved, [main])).toEqual(saved)
  })

  it('둘째 모니터가 사라졌으면 버린다 — 허공에 열면 보이지도 닫히지도 않는다', () => {
    const saved = { x: 2000, y: 100, width: 1200, height: 800 }
    expect(usableBounds(saved, [second])).toEqual(saved)
    expect(usableBounds(saved, [main])).toBeNull()
  })

  it('화면에 살짝만 걸치면 버린다 — 제목 줄을 잡을 만큼은 보여야 한다', () => {
    // 오른쪽 끝에서 30px 만 걸친 창: 옮길 손잡이가 안 나온다.
    expect(usableBounds({ x: 1770, y: 100, width: 1200, height: 800 }, [main])).toBeNull()
  })

  it('세로로만 걸쳐도 버린다 — 제목 줄이 화면 위로 넘어간 경우', () => {
    expect(usableBounds({ x: 200, y: -790, width: 1200, height: 800 }, [main])).toBeNull()
  })

  it('크기가 없는 자리는 버린다 (깨진 저장본)', () => {
    expect(usableBounds({ x: 0, y: 0, width: 0, height: 800 }, [main])).toBeNull()
    expect(usableBounds({ x: 0, y: 0, width: -5, height: -5 }, [main])).toBeNull()
  })

  it('화면이 하나도 없으면 버린다', () => {
    expect(usableBounds({ x: 0, y: 0, width: 1200, height: 800 }, [])).toBeNull()
  })
})
