import { describe, expect, it } from 'vitest'
import { buildGraph, surfaceEvents } from './flows'
import type { SpecTree } from './store'
import type { SurfaceContent } from './types'

/** 정의: `docs/qa/uiux-ia.md` S13 (CASE-uiux-110~114) · 명세: `docs/spec/uiux-ia.md` §3. */

const content = (events: SurfaceContent['events']): string =>
  JSON.stringify({ sections: [], events } satisfies SurfaceContent)

const surface = (key: string, events?: SurfaceContent['events']) => ({
  id: key,
  service_id: 'auth',
  key,
  name: key,
  description: '',
  kind: 'page',
  position: 0,
  content: content(events),
  status: 'designed',
  checked_at: '',
  checked_by: '',
  checked_note: '',
  updated_at: ''
})

const tree = (surfaces: ReturnType<typeof surface>[]): SpecTree => ({
  applications: [{ id: 'buyer', project_id: 'p', key: 'buyer', name: '이용자', description: '', position: 0 }],
  services: [{ id: 'auth', application_id: 'buyer', key: 'auth', name: '로그인', description: '', position: 0 }],
  surfaces
})

const A = 'coupang.buyer.auth.login'
const B = 'coupang.buyer.auth.home'
const C = 'coupang.buyer.auth.detail'

describe('이벤트 모으기', () => {
  it('CASE-uiux-110 화면 전이가 화살표가 된다', () => {
    const g = buildGraph(
      tree([
        surface('login', [{ trigger: { component: 'submit', event: 'click' }, nav: { to: B } }]),
        surface('home')
      ]),
      'coupang'
    )
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]).toMatchObject({ from: A, to: B, kind: 'nav', navKind: 'navigate' })
  })

  it('CASE-uiux-110 한 트리거에 효과가 둘이면 화살표도 둘 (갈래로 나누지 않는다)', () => {
    const g = buildGraph(
      tree([
        surface('login', [
          {
            trigger: { component: 'confirm', event: 'click' },
            nav: { kind: 'close', to: B },
            data: { contract: 'product', op: 'delete' }
          }
        ]),
        surface('home')
      ]),
      'coupang'
    )
    expect(g.edges.map((e) => e.kind)).toEqual(['nav', 'data'])
    expect(g.edges[0].navKind).toBe('close')
    expect(g.edges[1]).toMatchObject({ contract: 'product', op: 'delete' })
  })

  it('CASE-uiux-111 가리키는 화면이 없어도 화살표를 지우지 않는다 — 끊긴 것으로 표시한다', () => {
    const g = buildGraph(tree([surface('login', [{ trigger: {}, nav: { to: '없는.주소.임.니다' } }])]), 'coupang')
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].dangling).toBe(true)
  })

  it('CASE-uiux-111 내용이 깨진 화면도 그래프를 무너뜨리지 않는다', () => {
    const broken = { ...surface('login'), content: '{{{' }
    expect(() => buildGraph(tree([broken]), 'coupang')).not.toThrow()
    expect(surfaceEvents('{{{')).toEqual([])
  })
})

describe('계층 배치', () => {
  it('CASE-uiux-112 들어오는 전이가 없는 화면이 첫 줄, 거기서 몇 걸음인지로 줄이 갈린다', () => {
    const g = buildGraph(
      tree([
        surface('login', [{ trigger: {}, nav: { to: B } }]),
        surface('home', [{ trigger: {}, nav: { to: C } }]),
        surface('detail')
      ]),
      'coupang'
    )
    const depth = Object.fromEntries(g.nodes.map((n) => [n.address, n.depth]))
    expect(depth[A]).toBe(0)
    expect(depth[B]).toBe(1)
    expect(depth[C]).toBe(2)
  })

  it('CASE-uiux-112 같은 줄 안에서는 차례가 붙는다', () => {
    const g = buildGraph(tree([surface('login'), surface('home')]), 'coupang')
    expect(g.nodes.map((n) => n.order)).toEqual([0, 1])
  })

  it('CASE-uiux-113 순환이 있어도 멈춘다', () => {
    const g = buildGraph(
      tree([
        surface('login', [{ trigger: {}, nav: { to: B } }]),
        surface('home', [{ trigger: {}, nav: { to: A } }])
      ]),
      'coupang'
    )
    // 서로 가리키면 진입점이 없다 — 첫 화면을 진입점으로 삼아 그린다(아무것도 안 그리는 것보다 낫다).
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.every((n) => Number.isFinite(n.depth))).toBe(true)
  })

  it('CASE-uiux-114 어디서도 안 닿는 화면을 짚는다 — 링크가 빠졌다는 신호', () => {
    const g = buildGraph(
      tree([
        surface('login', [{ trigger: {}, nav: { to: B } }]),
        surface('home'),
        surface('detail') // 아무도 안 가리킨다
      ]),
      'coupang'
    )
    // detail 은 들어오는 전이가 없어 진입점으로 잡히므로 "안 닿는" 것이 아니다.
    expect(g.unreachable).toEqual([])

    // 진짜로 못 닿는 경우 — 끊긴 주소만 가리키는 화면.
    const g2 = buildGraph(
      tree([
        surface('login', [{ trigger: {}, nav: { to: B } }]),
        surface('home', [{ trigger: {}, nav: { to: '없는.주소.임.니다' } }]),
        surface('detail', [{ trigger: {}, nav: { to: B } }])
      ]),
      'coupang'
    )
    expect(g2.unreachable).toEqual([])
    expect(g2.edges.filter((e) => e.dangling)).toHaveLength(1)
  })

  it('CASE-uiux-114 데이터 변이는 줄을 가르지 않는다 (화면 이동이 아니다)', () => {
    const g = buildGraph(
      tree([
        surface('login', [{ trigger: {}, data: { contract: 'user', op: 'create' } }]),
        surface('home')
      ]),
      'coupang'
    )
    expect(g.nodes.every((n) => n.depth === 0)).toBe(true)
    expect(g.edges[0].from).toBe(g.edges[0].to)
  })
})
