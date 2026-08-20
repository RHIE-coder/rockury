import { describe, expect, it } from 'vitest'
import { diffSnapshots, nextVersionNumber, takeSnapshot, type Snapshot } from './versions'
import type { SpecTree } from './store'

/** CASE-uiux-130~134 · `uiux.versions`. */

const snap = (
  surfaces: { key: string; name?: string; kind?: string; status?: string; content?: string }[]
): Snapshot => ({
  applications: [{ id: 'app', key: 'buyer', name: '이용자' }],
  services: [{ id: 'svc', applicationId: 'app', key: 'auth', name: '로그인' }],
  surfaces: surfaces.map((s, i) => ({
    id: `id-${i}`,
    serviceId: 'svc',
    key: s.key,
    name: s.name ?? s.key,
    kind: s.kind ?? 'page',
    status: s.status ?? 'designed',
    content: s.content ?? '{"sections":[]}'
  }))
})

describe('스냅샷 뜨기', () => {
  it('CASE-uiux-130 트리에서 필요한 것만 추린다', () => {
    const tree: SpecTree = {
      applications: [{ id: 'a', project_id: 'p', key: 'buyer', name: '이용자', description: '', position: 0 }],
      services: [{ id: 's', application_id: 'a', key: 'auth', name: '로그인', description: '', position: 0 }],
      surfaces: [
        {
          id: 'sf',
          service_id: 's',
          key: 'login',
          name: '로그인 화면',
          description: '설명',
          kind: 'page',
          position: 0,
          content: '{"sections":[]}',
          status: 'designed',
          checked_at: '',
          checked_by: '',
          checked_note: '',
          updated_at: ''
        }
      ]
    }
    const s = takeSnapshot(tree)
    expect(s.surfaces[0]).toEqual({
      id: 'sf',
      serviceId: 's',
      key: 'login',
      name: '로그인 화면',
      kind: 'page',
      status: 'designed',
      content: '{"sections":[]}'
    })
  })
})

describe('두 버전 비교', () => {
  it('CASE-uiux-131 더해진 화면·사라진 화면을 가른다', () => {
    const d = diffSnapshots(snap([{ key: 'login' }]), snap([{ key: 'login' }, { key: 'home' }]))
    expect(d.find((x) => x.address.endsWith('home'))?.change).toBe('added')

    const d2 = diffSnapshots(snap([{ key: 'login' }, { key: 'home' }]), snap([{ key: 'login' }]))
    expect(d2.find((x) => x.address.endsWith('home'))?.change).toBe('removed')
  })

  it('CASE-uiux-132 주소로 짝짓는다 — 이름을 바꿔도 "지우고 새로 만든 것"이 되지 않는다', () => {
    const d = diffSnapshots(
      snap([{ key: 'login', name: '로그인' }]),
      snap([{ key: 'login', name: '로그인 화면' }])
    )
    expect(d).toHaveLength(1)
    expect(d[0].change).toBe('changed')
    expect(d[0].details).toEqual(['이름 로그인 → 로그인 화면'])
  })

  it('CASE-uiux-132 종류·상태 변화도 문장으로', () => {
    const d = diffSnapshots(
      snap([{ key: 'login', kind: 'page', status: 'designed' }]),
      snap([{ key: 'login', kind: 'modal', status: 'verified' }])
    )
    expect(d[0].details).toEqual(['종류 page → modal', '상태 designed → verified'])
  })

  it('CASE-uiux-133 화면 안 변화는 세어서 보인다', () => {
    const before = '{"sections":[{"id":"a","name":"","components":[{"id":"x","type":"input"}]}]}'
    const after =
      '{"sections":[{"id":"a","name":"","components":[{"id":"x","type":"input"},{"id":"y","type":"button"}]}],"events":[{"trigger":{"component":"y"},"nav":{"to":"p.a.s.b"}}]}'
    const d = diffSnapshots(snap([{ key: 'login', content: before }]), snap([{ key: 'login', content: after }]))
    expect(d[0].details).toEqual(['요소 1 → 2', '전이 0 → 1'])
  })

  it('CASE-uiux-133 개수가 같아도 내용이 다르면 말한다 (침묵하지 않는다)', () => {
    const before = '{"sections":[{"id":"a","name":"","components":[{"id":"x","type":"input"}]}]}'
    const after = '{"sections":[{"id":"a","name":"","components":[{"id":"x","type":"button"}]}]}'
    const d = diffSnapshots(snap([{ key: 'login', content: before }]), snap([{ key: 'login', content: after }]))
    expect(d[0].change).toBe('changed')
    expect(d[0].details).toEqual(['내용이 바뀌었어요'])
  })

  it('CASE-uiux-133 안 바뀐 화면은 same 이고 아무 말도 안 한다', () => {
    const d = diffSnapshots(snap([{ key: 'login' }]), snap([{ key: 'login' }]))
    expect(d[0]).toMatchObject({ change: 'same', details: [] })
  })

  it('CASE-uiux-134 볼 필요가 있는 것부터 위로 온다 (바뀜 → 더함 → 사라짐 → 그대로)', () => {
    const before = snap([{ key: 'a' }, { key: 'b', name: '옛 이름' }, { key: 'c' }])
    const after = snap([{ key: 'a' }, { key: 'b', name: '새 이름' }, { key: 'd' }])
    expect(diffSnapshots(before, after).map((x) => x.change)).toEqual([
      'changed',
      'added',
      'removed',
      'same'
    ])
  })

  it('CASE-uiux-134 빈 스냅샷끼리도 던지지 않는다', () => {
    expect(diffSnapshots(snap([]), snap([]))).toEqual([])
  })
})

describe('버전 번호', () => {
  it('CASE-uiux-134 마지막에서 가운데 자리를 올린다', () => {
    expect(nextVersionNumber([])).toBe('v0.1.0')
    expect(nextVersionNumber(['v0.1.0'])).toBe('v0.2.0')
    expect(nextVersionNumber(['v0.1.0', 'v0.3.0', 'v0.2.0'])).toBe('v0.4.0')
    // 형식이 아닌 것은 세지 않는다.
    expect(nextVersionNumber(['임시', 'v0.2.0'])).toBe('v0.3.0')
  })
})
