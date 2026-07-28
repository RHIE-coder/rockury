import { describe, it, expect } from 'vitest'
import { contentBounds, exportFileName, exportViewport, unionBounds } from './export'
import type { DesignNode } from './types'
import { EMPTY_DOC } from '../catalog/types'

const node = (over: Partial<DesignNode> & { id: string }): DesignNode => ({
  designId: 'd1',
  typeId: null,
  name: over.id,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: EMPTY_DOC,
  ...over
})

describe('exportFileName — 파일 이름', () => {
  const at = new Date(2026, 6, 29, 3, 7, 5) // 2026-07-29 03:07:05 (월은 0부터)

  it('설계본 이름 + 시각 + 확장자로 만든다', () => {
    expect(exportFileName('결제 아키텍처', 'png', at)).toBe('infra-결제-아키텍처-20260729-030705.png')
  })

  it('파일시스템이 싫어하는 문자는 하이픈으로 바꾸고 양끝은 다듬는다', () => {
    expect(exportFileName('  a/b:c*?  ', 'svg', at)).toBe('infra-a-b-c-20260729-030705.svg')
  })

  it('이름이 없거나 전부 특수문자면 기본 이름으로 떨어진다 — 빈 파일명을 만들지 않는다', () => {
    expect(exportFileName('', 'png', at)).toBe('infra-diagram-20260729-030705.png')
    expect(exportFileName('///', 'png', at)).toBe('infra-diagram-20260729-030705.png')
  })
})

describe('unionBounds — 사각형 합집합', () => {
  it('빈 배열이면 0 사각형(빈 캔버스에서 크래시하지 않는다)', () => {
    expect(unionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('떨어진 사각형 둘을 다 감싼다', () => {
    const r = unionBounds([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 90, y: 40, width: 10, height: 10 }
    ])
    expect(r).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  it('음수 좌표도 감싼다', () => {
    expect(unionBounds([{ x: -30, y: -10, width: 10, height: 10 }])).toEqual({
      x: -30,
      y: -10,
      width: 10,
      height: 10
    })
  })
})

describe('contentBounds — 중첩을 절대 좌표로 펴서 잰다', () => {
  it('최상위 노드들의 경계를 낸다', () => {
    const r = contentBounds([node({ id: 'a', x: 10, y: 20 }), node({ id: 'b', x: 300, y: 0, w: 100, h: 40 })])
    expect(r).toEqual({ x: 10, y: 0, width: 390, height: 80 })
  })

  it('자식 좌표는 부모 기준 상대값이다 — 절대값으로 펴서 재야 경계가 맞는다', () => {
    // 부모(500,500) 안의 자식(24,32) → 절대 (524,532). 상대값 그대로 재면 원점 근처로 잘못 잡힌다.
    const nodes = [
      node({ id: 'p', x: 500, y: 500, w: 260, h: 130 }),
      node({ id: 'c', parentId: 'p', x: 24, y: 32, w: 200, h: 60 })
    ]
    const r = contentBounds(nodes)
    expect(r).toEqual({ x: 500, y: 500, width: 260, height: 130 })
  })

  it('자식이 부모 밖으로 삐져나가면 그만큼 넓힌다(잘림 방지)', () => {
    const nodes = [
      node({ id: 'p', x: 0, y: 0, w: 100, h: 100 }),
      node({ id: 'c', parentId: 'p', x: 80, y: 80, w: 200, h: 60 })
    ]
    expect(contentBounds(nodes)).toEqual({ x: 0, y: 0, width: 280, height: 140 })
  })

  it('노드가 없으면 0 사각형', () => {
    expect(contentBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('exportViewport — 캔버스 크기와 이동값', () => {
  it('콘텐츠 좌상단이 (pad, pad) 로 오도록 옮기고 원본 배율을 지킨다', () => {
    const v = exportViewport({ x: 40, y: 25, width: 300, height: 120 }, 48)
    expect(v).toEqual({ width: 396, height: 216, x: 8, y: 23, zoom: 1 })
  })

  it('음수 좌표에서 시작해도 콘텐츠가 캔버스 안으로 들어온다', () => {
    const v = exportViewport({ x: -100, y: -50, width: 200, height: 100 }, 10)
    expect(v).toEqual({ width: 220, height: 120, x: 110, y: 60, zoom: 1 })
  })

  it('소수점 크기는 올림한다 — 반 픽셀이 잘려 테두리가 사라지지 않게', () => {
    const v = exportViewport({ x: 0, y: 0, width: 100.2, height: 50.9 }, 0)
    expect(v.width).toBe(101)
    expect(v.height).toBe(51)
  })
})
