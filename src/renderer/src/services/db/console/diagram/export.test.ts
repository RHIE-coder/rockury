import { describe, it, expect } from 'vitest'
import { exportFileName, exportViewport, unionBounds } from './export'

describe('exportFileName', () => {
  const d = new Date(2026, 6, 23, 9, 5, 7) // 2026-07-23 09:05:07 (로컬)

  it('erd-<연결>-<타임스탬프>.<ext> 형식', () => {
    expect(exportFileName('prod', 'png', d)).toBe('erd-prod-20260723-090507.png')
    expect(exportFileName('prod', 'svg', d)).toBe('erd-prod-20260723-090507.svg')
  })

  it('연결명의 비안전 문자는 하이픈으로 정규화', () => {
    expect(exportFileName('My DB @ Host:5432', 'png', d)).toBe('erd-My-DB-Host-5432-20260723-090507.png')
  })

  it('빈/전부불안전 연결명은 diagram 으로 폴백', () => {
    expect(exportFileName('', 'png', d)).toBe('erd-diagram-20260723-090507.png')
    expect(exportFileName('@@@', 'svg', d)).toBe('erd-diagram-20260723-090507.svg')
  })
})

describe('exportViewport', () => {
  it('캔버스는 경계 + 사방 pad, 원본 스케일(zoom=1)', () => {
    const vp = exportViewport({ x: 100, y: 50, width: 400, height: 300 }, 48)
    expect(vp).toEqual({ width: 496, height: 396, x: -52, y: -2, zoom: 1 })
  })

  it('콘텐츠 사방 여백이 정확히 pad — 남는 여백 없음', () => {
    const bounds = { x: 100, y: 50, width: 400, height: 300 }
    const pad = 48
    const vp = exportViewport(bounds, pad)
    // 렌더 좌표 = flow좌표 * zoom + 평행이동
    const left = bounds.x * vp.zoom + vp.x
    const top = bounds.y * vp.zoom + vp.y
    const right = (bounds.x + bounds.width) * vp.zoom + vp.x
    const bottom = (bounds.y + bounds.height) * vp.zoom + vp.y
    expect(left).toBe(pad)
    expect(top).toBe(pad)
    expect(vp.width - right).toBe(pad)
    expect(vp.height - bottom).toBe(pad)
  })

  it('음수 원점 경계도 pad 만큼 안으로 들어오게 평행이동', () => {
    const vp = exportViewport({ x: -200, y: -100, width: 150, height: 120 }, 20)
    expect(vp).toEqual({ width: 190, height: 160, x: 220, y: 120, zoom: 1 })
  })

  it('소수 경계 폭·높이는 올림해 잘림 방지', () => {
    const vp = exportViewport({ x: 0, y: 0, width: 400.2, height: 299.6 }, 10)
    expect(vp.width).toBe(421) // ceil(400.2)=401 + 20
    expect(vp.height).toBe(320) // ceil(299.6)=300 + 20
  })
})

describe('unionBounds', () => {
  it('빈 배열은 0 사각형', () => {
    expect(unionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('단일 사각형은 그대로', () => {
    expect(unionBounds([{ x: 10, y: 20, width: 30, height: 40 }])).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('노드 경계 밖으로 부푸는 선(자기참조 루프)을 감싸 오른쪽 확장', () => {
    const node = { x: 0, y: 0, width: 200, height: 100 }
    // 자기참조 루프가 노드 오른쪽 60px 밖으로, 위로 50px 부풀어 나감
    const selfLoop = { x: 200, y: -50, width: 60, height: 150 }
    expect(unionBounds([node, selfLoop])).toEqual({ x: 0, y: -50, width: 260, height: 150 })
  })

  it('사방으로 흩어진 여러 사각형의 합집합', () => {
    const rects = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: -20, y: 5, width: 10, height: 10 },
      { x: 100, y: -30, width: 40, height: 40 }
    ]
    expect(unionBounds(rects)).toEqual({ x: -20, y: -30, width: 160, height: 45 })
  })
})
