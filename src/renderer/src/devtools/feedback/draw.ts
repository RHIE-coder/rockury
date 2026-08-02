import { MARK_HALO, type Point, type Shape } from './types'

/**
 * 그리기 기하 — 도형 하나가 실제로 어떤 선이 되는지 아는 유일한 곳.
 *
 * 왜 갈라 뒀나: 같은 자국을 여러 곳이 그린다 — 화면 위 SVG(오버레이), 스케치판의 SVG
 * (그리는 중), 스케치판이 굽는 PNG(`sketch-N.png`). 각자 좌표를 계산하면 화면에서 본
 * 것과 저장된 그림이 조용히 어긋나는데, 그 어긋남은 보내기 전엔 알 길이 없다. 그래서
 * 모든 도형을 **폴리라인(꺾은선) 묶음** 한 가지로만 표현하고, 그리는 쪽은 전부 이 한
 * 함수를 읽는다.
 *
 * 여기 있는 것은 전부 순수 함수다 — DOM 없이 테스트로 못박기 위한 것(draw.test.ts).
 */

/** 화살촉 길이 — 선이 굵어지면 같이 커져야 촉이 선에 묻히지 않는다. */
function headLength(width: number): number {
  return Math.max(11, width * 3.5)
}

/** 화살촉이 벌어지는 각(라디안). 좁으면 못처럼, 넓으면 갈매기처럼 보인다. */
const HEAD_SPREAD = 0.42

/**
 * 도형 하나를 그리는 데 필요한 폴리라인 묶음.
 * 빈 배열이면 아직 그릴 것이 없다는 뜻이다(점 하나만 찍힌 상태 등).
 */
export function polylinesOf(shape: Shape): Point[][] {
  const pts = shape.points
  if (pts.length === 0) return []
  const a = pts[0]
  const b = pts[pts.length - 1]
  switch (shape.tool) {
    case 'pen':
      return pts.length < 2 ? [] : [pts]
    case 'line':
      return [[a, b]]
    case 'arrow': {
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      const len = headLength(shape.width)
      const wing = (turn: number): Point => ({
        x: b.x - len * Math.cos(angle + turn),
        y: b.y - len * Math.sin(angle + turn)
      })
      // 촉은 끊긴 폴리라인으로 둔다 — 몸통에 이어 붙이면 되돌아오는 선이 겹쳐 두꺼워진다.
      return [
        [a, b],
        [wing(-HEAD_SPREAD), b, wing(HEAD_SPREAD)]
      ]
    }
    case 'box':
      return [[a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]]
  }
}

export function boundsOfPoints(points: Point[]): {
  x: number
  y: number
  width: number
  height: number
} {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** 자국이 실제로 덮은 영역 — 화살촉까지 포함한다(몸통만 재면 촉이 배지 밖으로 삐져나온다). */
export function boundsOfShape(shape: Shape): { x: number; y: number; width: number; height: number } {
  return boundsOfPoints(polylinesOf(shape).flat())
}

/** SVG `d` 문자열. 화면 위 그리기와 스케치판이 같이 쓴다. */
export function svgPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

/**
 * 캔버스에 자국들을 굽는다(스케치판이 PNG 로 내보낼 때).
 * 흰 테두리를 먼저 깔아야 어두운 색 위에서도 읽힌다 — 화면 SVG 와 같은 규칙이다.
 */
export function strokeShapes(
  ctx: CanvasRenderingContext2D,
  shapes: readonly Shape[],
  scale: number
): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const shape of shapes) {
    const lines = polylinesOf(shape)
    if (lines.length === 0) continue
    const trace = (): void => {
      ctx.beginPath()
      for (const line of lines) {
        line.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * scale, p.y * scale)
          else ctx.lineTo(p.x * scale, p.y * scale)
        })
      }
    }
    trace()
    ctx.strokeStyle = MARK_HALO
    ctx.lineWidth = (shape.width + 3) * scale
    ctx.stroke()
    trace()
    ctx.strokeStyle = shape.color
    ctx.lineWidth = shape.width * scale
    ctx.stroke()
  }
}

/** 점 p 에서 선분 ab 까지의 거리. 지우개가 "이 자국을 짚었다"를 판정하는 자다. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // 길이 0 인 선분(같은 점 두 개)은 점까지의 거리로 떨어진다 — 0 으로 나누지 않는다.
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** (x, y) 가 이 자국 위인가. 굵을수록 판정도 같이 넓어진다(굵은 선은 눈에도 넓다). */
export function shapeContains(shape: Shape, x: number, y: number, slack = 8): number | null {
  const p = { x, y }
  let best: number | null = null
  for (const line of polylinesOf(shape)) {
    for (let i = 1; i < line.length; i += 1) {
      const d = distanceToSegment(p, line[i - 1], line[i])
      if (d <= shape.width / 2 + slack && (best === null || d < best)) best = d
    }
  }
  return best
}

/**
 * 지우개가 집을 표시의 id. 겹치면 **더 가까운 것**이 이긴다 — 나중에 그린 것이 이기게 하면
 * 굵은 자국 하나가 그 아래 얇은 자국을 영영 못 지우게 만든다.
 * 자국이 없는 핀은 배지 원으로 판정한다(`badgeHit` 이 그 몫이라 여기서는 다루지 않는다).
 */
export function eraserHit<T extends { id: number; shape: Shape | null }>(
  marks: readonly T[],
  x: number,
  y: number
): number | null {
  let hitId: number | null = null
  let hitDist = Number.POSITIVE_INFINITY
  for (const m of marks) {
    if (!m.shape) continue
    const d = shapeContains(m.shape, x, y)
    if (d !== null && d < hitDist) {
      hitDist = d
      hitId = m.id
    }
  }
  return hitId
}
