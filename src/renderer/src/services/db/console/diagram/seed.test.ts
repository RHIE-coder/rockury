import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { seedNodes } from './seed'

const node = (id: string, x: number, y: number, measured?: { width: number; height: number }): Node => ({
  id,
  type: 'tableErd',
  position: { x, y },
  data: {},
  ...(measured ? { measured } : {})
})

// dagre 기본 배치를 흉내낸 base — 저장/화면 위치가 이걸 덮어야 정상.
const base = [node('a', 20, 20), node('b', 220, 20)]

describe('seedNodes', () => {
  it('첫 seed: 저장된 위치를 입히고, 저장에 없는 노드는 base(dagre) 자리 유지', () => {
    const stored = { a: { x: 500, y: 500 } }
    const out = seedNodes(base, base, true, stored)
    expect(out.find((n) => n.id === 'a')!.position).toEqual({ x: 500, y: 500 })
    expect(out.find((n) => n.id === 'b')!.position).toEqual({ x: 220, y: 20 })
  })

  it('이후 seed: 현재 화면(prev) 위치를 보존하고 새 노드만 base 자리', () => {
    const prev = [node('a', 111, 222)] // 사용자가 a 를 옮겨둔 화면
    const grown = [...base, node('c', 420, 20)]
    const out = seedNodes(grown, prev, false, { a: { x: 500, y: 500 } })
    expect(out.find((n) => n.id === 'a')!.position).toEqual({ x: 111, y: 222 }) // 저장값 아닌 화면값
    expect(out.find((n) => n.id === 'c')!.position).toEqual({ x: 420, y: 20 })
  })

  it('회귀: StrictMode 이중 호출 — 같은 prev 로 두 번 불러도 저장 위치가 적용된다(순수·멱등)', () => {
    // 과거 버그: first 판정(ref 변경)이 updater 안에 있어 두 번째 호출이 first=false 로 오판,
    // 저장 위치 대신 dagre 배치가 적용됐다. first 를 밖에서 넘기면 두 호출 결과가 같아야 한다.
    const stored = { a: { x: 500, y: 500 }, b: { x: 800, y: 650 } }
    const call1 = seedNodes(base, base, true, stored)
    const call2 = seedNodes(base, base, true, stored) // StrictMode 가 같은 prev 로 재호출
    expect(call2).toEqual(call1)
    expect(call2.find((n) => n.id === 'a')!.position).toEqual({ x: 500, y: 500 })
    expect(call2.find((n) => n.id === 'b')!.position).toEqual({ x: 800, y: 650 })
    // 입력 불변(부수효과 없음) — prev/base 가 변형되지 않아야 진짜 순수다.
    expect(base.find((n) => n.id === 'a')!.position).toEqual({ x: 20, y: 20 })
  })

  it('measured 는 prev 에서 이월(재측정 깜빡임 방지), 새 노드는 undefined', () => {
    const prev = [node('a', 20, 20, { width: 180, height: 120 })]
    const out = seedNodes(base, prev, false, {})
    expect(out.find((n) => n.id === 'a')!.measured).toEqual({ width: 180, height: 120 })
    expect(out.find((n) => n.id === 'b')!.measured).toBeUndefined()
  })
})
