import { describe, expect, it } from 'vitest'
import {
  boundsOfPoints,
  boundsOfShape,
  partHit,
  polylinesOf,
  shapeContains,
  shapeHit,
  svgPath
} from './draw'
import type { Shape } from './types'

/**
 * 그리기 기하 회귀 테스트.
 * 이 파일이 지키는 계약은 하나다 — 화면 위 SVG 와 스케치판이 굽는 PNG 가 **같은 한 함수**를
 * 읽는다. 각자 계산하면 화면에서 본 것과 저장된 그림이 조용히 어긋나는데, 그 어긋남은
 * 보내기 전엔 알 길이 없다.
 */

const shape = (over: Partial<Shape>): Shape => ({
  tool: 'pen',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 }
  ],
  color: '#eb4e63',
  width: 3,
  ...over
})

describe('polylinesOf — 도구마다 어떤 선이 되는가', () => {
  it('펜은 지나온 길 그대로다', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 9, y: 2 }
    ]
    expect(polylinesOf(shape({ tool: 'pen', points: pts }))).toEqual([pts])
  })

  // 점 하나만으로는 선이 안 된다. 스치기만 한 자국을 그리려다 빈 path 가 나오면 안 된다.
  it('점 하나짜리 펜은 그릴 것이 없다', () => {
    expect(polylinesOf(shape({ tool: 'pen', points: [{ x: 3, y: 3 }] }))).toEqual([])
  })

  it('직선은 시작과 끝 둘만 쓴다 — 중간에 지나간 점은 버린다', () => {
    const s = shape({
      tool: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 9 },
        { x: 10, y: 10 }
      ]
    })
    expect(polylinesOf(s)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ]
    ])
  })

  it('상자는 네 귀를 돌아 시작점으로 닫힌다', () => {
    const s = shape({
      tool: 'box',
      points: [
        { x: 2, y: 4 },
        { x: 12, y: 10 }
      ]
    })
    expect(polylinesOf(s)).toEqual([
      [
        { x: 2, y: 4 },
        { x: 12, y: 4 },
        { x: 12, y: 10 },
        { x: 2, y: 10 },
        { x: 2, y: 4 }
      ]
    ])
  })

  describe('화살표', () => {
    const s = shape({
      tool: 'arrow',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ]
    })

    // 촉을 몸통에 이어 붙이면 되돌아오는 선이 겹쳐 그 구간만 두껍게 나온다.
    it('몸통과 촉이 끊긴 두 줄로 나온다', () => {
      const lines = polylinesOf(s)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ])
      expect(lines[1]).toHaveLength(3)
    })

    it('촉은 끝점에 모이고 뒤쪽으로 벌어진다', () => {
      const [, head] = polylinesOf(s)
      expect(head[1]).toEqual({ x: 100, y: 0 })
      // 오른쪽으로 그린 화살표라 양 날개는 끝점보다 왼쪽(x 가 작다)에 있고, 위아래로 갈린다.
      expect(head[0].x).toBeLessThan(100)
      expect(head[2].x).toBeLessThan(100)
      expect(Math.sign(head[0].y)).toBe(-Math.sign(head[2].y))
    })

    it('선이 굵어지면 촉도 같이 커진다 — 얇은 촉이 굵은 선에 묻히지 않게', () => {
      const thin = polylinesOf({ ...s, width: 2 })[1][0]
      const thick = polylinesOf({ ...s, width: 8 })[1][0]
      expect(100 - thick.x).toBeGreaterThan(100 - thin.x)
    })
  })
})

describe('boundsOfShape — 배지가 앉을 자리', () => {
  it('펜은 지나온 점들을 감싼다', () => {
    const s = shape({
      tool: 'pen',
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 5 }
      ]
    })
    expect(boundsOfShape(s)).toEqual({ x: 10, y: 5, width: 30, height: 15 })
  })

  // 몸통만 재면 촉이 배지 밖으로 삐져나온다 — 배지가 자국을 안 가리키는 것처럼 보인다.
  it('화살표는 촉까지 감싼다', () => {
    const s = shape({
      tool: 'arrow',
      points: [
        { x: 0, y: 50 },
        { x: 100, y: 50 }
      ]
    })
    const b = boundsOfShape(s)
    expect(b.height).toBeGreaterThan(0)
    expect(b.y).toBeLessThan(50)
  })

  it('점이 없으면 0 크기다 — NaN 이 좌표로 새 나가지 않는다', () => {
    expect(boundsOfPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('svgPath', () => {
  it('첫 점만 M 이고 나머지는 L 이다', () => {
    expect(
      svgPath([
        { x: 1, y: 2 },
        { x: 3, y: 4 }
      ])
    ).toBe('M1 2 L3 4')
  })
})

describe('shapeContains · partHit — 지우개가 무엇을 집는가', () => {
  const line = shape({
    tool: 'line',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
  })

  /** 배지가 판정에 끼어들지 않게 자국에서 멀리 떨어뜨린 자리. */
  const FAR = { x: 900, y: 900, width: 0, height: 0 }

  it('선 위를 짚으면 잡힌다', () => {
    expect(shapeContains(line, 50, 0)).not.toBeNull()
  })

  it('선 끝 너머를 짚으면 안 잡힌다 — 선분이지 무한 직선이 아니다', () => {
    expect(shapeContains(line, 200, 0)).toBeNull()
  })

  it('멀면 안 잡힌다', () => {
    expect(shapeContains(line, 50, 60)).toBeNull()
  })

  // 굵은 자국이 얇은 자국을 덮고 있으면, "나중에 그린 것이 이긴다" 규칙으로는 아래 것을
  // 영영 못 지운다. 그래서 더 가까운 쪽이 이긴다.
  it('겹치면 더 가까운 자국을 집는다 — 그린 순서가 아니라', () => {
    const marks = [
      {
        id: 1,
        parts: [
          {
            bounds: FAR,
            shape: shape({
              tool: 'line',
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 }
              ],
              width: 2
            })
          }
        ]
      },
      {
        id: 2,
        parts: [
          {
            bounds: FAR,
            shape: shape({
              tool: 'line',
              points: [
                { x: 0, y: 20 },
                { x: 100, y: 20 }
              ],
              width: 6
            })
          }
        ]
      }
    ]
    expect(partHit(marks, 50, 1)?.id).toBe(1)
    expect(partHit(marks, 50, 19)?.id).toBe(2)
  })

  it('묶음 안에서는 자국 하나가 집힌다 — 묶음째 지우면 애써 적은 메모까지 날아간다', () => {
    const marks = [
      {
        id: 1,
        parts: [
          { bounds: FAR, shape: line },
          {
            bounds: FAR,
            shape: shape({
              tool: 'line',
              points: [
                { x: 0, y: 40 },
                { x: 100, y: 40 }
              ]
            })
          }
        ]
      }
    ]
    expect(partHit(marks, 50, 40)).toEqual({ id: 1, part: 1 })
  })

  // 핀은 자국이 없어 배지가 유일한 손잡이다. 배지와 자국을 한 자로 재는 이유가 이것.
  it('자국 없는 핀은 배지 원으로 잡힌다', () => {
    const pin = [{ id: 9, parts: [{ bounds: { x: 0, y: 0, width: 22, height: 22 }, shape: null }] }]
    expect(partHit(pin, 11, 11)).toEqual({ id: 9, part: 0 })
    expect(partHit(pin, 300, 300)).toBeNull()
  })

  it('지난 화면의 자국은 안 집는다 — 눈에 안 보이는데 지워지면 유령을 지우는 셈이다', () => {
    const marks = [{ id: 1, parts: [{ bounds: FAR, shape: line, screen: 1 }] }]
    expect(partHit(marks, 50, 0, 1)).toEqual({ id: 1, part: 0 })
    expect(partHit(marks, 50, 0, 2)).toBeNull()
  })

  it('아무것도 안 걸리면 null 이다', () => {
    expect(partHit([{ id: 1, parts: [{ bounds: FAR, shape: line }] }], 500, 500)).toBeNull()
  })

  // 스케치판에는 배지가 없다 — 자국이 곧 전부라 판정도 자국 하나만 본다.
  it('스케치판은 자국만 본다 (shapeHit)', () => {
    const placed = [
      { id: 1, shape: line },
      {
        id: 2,
        shape: shape({
          tool: 'line',
          points: [
            { x: 0, y: 40 },
            { x: 100, y: 40 }
          ]
        })
      }
    ]
    expect(shapeHit(placed, 50, 40)).toBe(2)
    expect(shapeHit(placed, 500, 500)).toBeNull()
  })
})
