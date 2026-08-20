import { describe, expect, it } from 'vitest'
import { completion, gaps, summarizeTree } from './features'
import type { SpecTree } from './store'


const surface = (id: string, serviceId: string, status: string) => ({
  id,
  service_id: serviceId,
  key: id,
  name: id,
  description: '',
  kind: 'page',
  position: 0,
  content: '{"sections":[]}',
  status,
  checked_at: '',
  checked_by: '',
  checked_note: '',
  updated_at: ''
})

const tree: SpecTree = {
  applications: [
    { id: 'buyer', project_id: 'p', key: 'buyer', name: '이용자 앱', description: '', position: 0 },
    { id: 'admin', project_id: 'p', key: 'admin', name: '관리자 앱', description: '', position: 1 }
  ],
  services: [
    { id: 'pay', application_id: 'buyer', key: 'pay', name: '결제', description: '', position: 0 },
    { id: 'ship', application_id: 'buyer', key: 'ship', name: '배송', description: '', position: 1 },
    { id: 'empty', application_id: 'admin', key: 'empty', name: '빈 서비스', description: '', position: 0 }
  ],
  surfaces: [
    surface('a', 'pay', 'verified'),
    surface('b', 'pay', 'verified'),
    surface('c', 'ship', 'implemented'),
    surface('d', 'ship', 'designed'),
    surface('e', 'ship', 'designed')
  ]
}

describe('능력별 집계', () => {
  const summary = summarizeTree(tree)

  it('CASE-uiux-090 앱 › 서비스로 접어 센다 — 화면 단위로 세면 사람 말이 안 된다', () => {
    const buyer = summary.applications[0]
    expect(buyer.name).toBe('이용자 앱')
    expect(buyer.services.map((s) => s.name)).toEqual(['결제', '배송'])
    expect(buyer.services[0].counts).toEqual({ total: 2, designed: 0, implemented: 0, verified: 2 })
    expect(buyer.services[1].counts).toEqual({ total: 3, designed: 2, implemented: 1, verified: 0 })
  })

  it('CASE-uiux-090 위로 올라가며 합쳐진다', () => {
    expect(summary.applications[0].counts).toEqual({ total: 5, designed: 2, implemented: 1, verified: 2 })
    expect(summary.counts).toEqual({ total: 5, designed: 2, implemented: 1, verified: 2 })
  })

  it('CASE-uiux-091 화면이 없는 앱·서비스도 빠뜨리지 않는다 — 빠진 자리를 봐야 한다', () => {
    const admin = summary.applications[1]
    expect(admin.name).toBe('관리자 앱')
    expect(admin.services).toHaveLength(1)
    expect(admin.counts).toEqual({ total: 0, designed: 0, implemented: 0, verified: 0 })
  })

  it('CASE-uiux-091 모르는 상태 값은 설계됨으로 본다 (저장소는 열린 문자열이다)', () => {
    const odd: SpecTree = { ...tree, surfaces: [surface('x', 'pay', '이상한값')] }
    expect(summarizeTree(odd).counts).toEqual({ total: 1, designed: 1, implemented: 0, verified: 0 })
  })

  it('CASE-uiux-091 빈 트리도 던지지 않는다', () => {
    const empty = summarizeTree({ applications: [], services: [], surfaces: [] })
    expect(empty.applications).toEqual([])
    expect(empty.counts.total).toBe(0)
  })
})

describe('완성도', () => {
  it('CASE-uiux-092 확인된 것만 센다 — 구현만 된 것을 완성으로 세면 "다 됐다"가 거짓이 된다', () => {
    expect(completion({ total: 4, designed: 0, implemented: 2, verified: 2 })).toBe(0.5)
    expect(completion({ total: 2, designed: 0, implemented: 0, verified: 2 })).toBe(1)
    expect(completion({ total: 3, designed: 0, implemented: 3, verified: 0 })).toBe(0)
  })

  it('CASE-uiux-092 화면이 없으면 0 (나눗셈을 하지 않는다)', () => {
    expect(completion({ total: 0, designed: 0, implemented: 0, verified: 0 })).toBe(0)
  })
})

describe('빠진 곳', () => {
  it('CASE-uiux-093 화면이 있는데 확인이 하나도 없는 서비스를 짚는다', () => {
    expect(gaps(summarizeTree(tree))).toEqual([{ application: '이용자 앱', service: '배송', total: 3 }])
  })

  it('CASE-uiux-093 화면이 아직 없는 서비스는 넣지 않는다 (설계를 시작도 안 한 것은 다른 이야기)', () => {
    const onlyEmpty: SpecTree = { ...tree, surfaces: [] }
    expect(gaps(summarizeTree(onlyEmpty))).toEqual([])
  })
})
