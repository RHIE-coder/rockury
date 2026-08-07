import { describe, expect, it } from 'vitest'
import { STRIP_CATCH, stripUnderPoint, tearOffBounds, type WindowStrip } from './windowDrag'

/** 화면 (100,100) 에 놓인 1000×800 창의, 위에서 36px 자리에 있는 높이 32 탭 줄. */
function win(id: number, x: number, y: number): WindowStrip<number> {
  return {
    id,
    content: { x, y, width: 1000, height: 800 },
    strip: { left: 0, top: 36, width: 1000, height: 32 }
  }
}

describe('stripUnderPoint — 커서 밑에 어느 창의 탭 줄이 있나', () => {
  const windows = [win(1, 100, 100)]

  it('줄 위면 그 창', () => {
    expect(stripUnderPoint(windows, { x: 500, y: 150 })).toBe(1)
  })

  it('같은 창이라도 줄이 아닌 데면 아니다 — 본문에 떨어뜨렸다고 삼키면 안 된다', () => {
    expect(stripUnderPoint(windows, { x: 500, y: 400 })).toBe(null)
    expect(stripUnderPoint(windows, { x: 500, y: 120 })).toBe(null)
  })

  it('창 밖이면 아니다', () => {
    expect(stripUnderPoint(windows, { x: 50, y: 150 })).toBe(null)
    expect(stripUnderPoint(windows, { x: 1200, y: 150 })).toBe(null)
  })

  it('줄 위아래 여유 폭까지는 잡아 준다 — 32px 을 정확히 맞히라고 요구하지 않는다', () => {
    expect(stripUnderPoint(windows, { x: 500, y: 136 - STRIP_CATCH })).toBe(1)
    expect(stripUnderPoint(windows, { x: 500, y: 168 + STRIP_CATCH })).toBe(1)
    expect(stripUnderPoint(windows, { x: 500, y: 136 - STRIP_CATCH - 1 })).toBe(null)
  })

  it('창이 겹치면 나중에 뜬 쪽을 고른다', () => {
    const two = [win(1, 100, 100), win(2, 100, 100)]
    expect(stripUnderPoint(two, { x: 500, y: 150 })).toBe(2)
  })

  it('아무 창도 없으면 null', () => {
    expect(stripUnderPoint([], { x: 500, y: 150 })).toBe(null)
  })
})

describe('tearOffBounds — 떨어져 나간 창을 놓을 자리', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 1000, height: 700 }

  it('잡고 있던 지점이 커서 밑에 그대로 온다', () => {
    const b = tearOffBounds(size, { x: 800, y: 400 }, { x: 120, y: 50 }, work)
    expect(b).toEqual({ x: 680, y: 350, width: 1000, height: 700 })
  })

  it('작업영역 왼위 밖으로는 안 나간다', () => {
    const b = tearOffBounds(size, { x: 10, y: 10 }, { x: 120, y: 50 }, work)
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })

  it('작업영역 오른아래 밖으로도 안 나간다 — 창 전체가 안에 남는다', () => {
    const b = tearOffBounds(size, { x: 1900, y: 1070 }, { x: 10, y: 10 }, work)
    expect(b.x).toBe(920)
    expect(b.y).toBe(380)
  })

  it('작업영역의 원점이 0 이 아니어도 그 안에 든다 (메뉴바·둘째 모니터)', () => {
    const second = { x: 1920, y: 25, width: 1440, height: 900 }
    const b = tearOffBounds(size, { x: 1930, y: 30 }, { x: 500, y: 50 }, second)
    expect(b.x).toBe(1920)
    expect(b.y).toBe(25)
  })

  it('잡은 지점이 창 크기를 넘으면 창 안으로 조인다 — 꽉 찬 창에서 빼내면 창이 작아진다', () => {
    // 1920 폭 창의 오른쪽 끝(1700)을 잡았는데 창이 1000 폭으로 작아진 경우.
    const b = tearOffBounds(size, { x: 1700, y: 400 }, { x: 1700, y: 50 }, work)
    expect(b.x).toBe(700)
  })

  it('창이 작업영역보다 크면 왼위에 붙인다', () => {
    const b = tearOffBounds({ width: 2000, height: 1200 }, { x: 500, y: 500 }, { x: 0, y: 0 }, work)
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
  })
})
