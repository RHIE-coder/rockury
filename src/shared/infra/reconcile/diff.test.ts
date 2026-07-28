import { describe, it, expect } from 'vitest'
import { reconcile } from './diff'
import type { LiveResource, ReconNode, ReconType } from '../types'

/**
 * 대조가 종류에서 보는 것은 **비교 필드뿐**이다(`ReconType`).
 * 아이콘·라벨은 화면 쪽 일이라 여기 오지 않는다 — 그래서 메인도 같은 함수를 부를 수 있다.
 */
const types: Record<string, ReconType> = {
  'docker.container': { compareFields: ['status'] },
  'docker.network': {},
  'aws.ec2': { compareFields: ['status', 'type'] }
}

const node = (p: Partial<ReconNode> & { id: string; name: string }): ReconNode => ({
  typeId: 'docker.container',
  parentId: null,
  ...p
})

const live = (p: Partial<LiveResource> & { externalId: string }): LiveResource => ({
  typeId: 'docker.container',
  name: p.externalId,
  status: 'ok',
  rawStatus: 'running',
  ...p
})

const checked = new Set(['docker.container', 'docker.network'])

describe('reconcile — 대조 판정', () => {
  it('CASE-iarch-030 설계에만 있으면 미구축', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [],
      types,
      checkedTypeIds: checked
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].verdict).toBe('missing')
    expect(rows[0].designNode?.id).toBe('n1')
  })

  it('CASE-iarch-031 실물에만 있으면 미등록', () => {
    const rows = reconcile({
      nodes: [],
      resources: [live({ externalId: 'c1' })],
      types,
      checkedTypeIds: checked
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].verdict).toBe('unregistered')
    expect(rows[0].resources[0].externalId).toBe('c1')
  })

  it('CASE-iarch-033 둘 다 있고 같으면 어긋남이 안 뜬다 — 소음 없음', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [live({ externalId: 'c1', name: 'web', status: 'ok' })],
      types,
      checkedTypeIds: checked
    })
    expect(rows.filter((r) => r.verdict !== 'ok')).toHaveLength(0)
  })

  it('CASE-iarch-032 상태가 정상이 아니면 어긋남 — 무엇이 어떻게 다른지 필드 단위로 낸다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [live({ externalId: 'c1', name: 'web', status: 'stopped', rawStatus: 'exited' })],
      types,
      checkedTypeIds: checked
    })
    const row = rows.find((r) => r.verdict === 'drift')
    expect(row).toBeTruthy()
    expect(row?.fields).toHaveLength(1)
    expect(row?.fields[0].field).toBe('status')
    expect(row?.fields[0].live).toContain('exited')
    expect(row?.fields[0].design).toContain('정상')
  })

  it('CASE-iarch-032 종류가 다르면 어긋남으로 잡힌다(비교 필드에 type 이 있을 때)', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'srv', typeId: 'aws.ec2' })],
      resources: [live({ externalId: 'i-1', name: 'srv', typeId: 'docker.container' })],
      types,
      checkedTypeIds: new Set(['aws.ec2', 'docker.container'])
    })
    const row = rows.find((r) => r.verdict === 'drift')
    expect(row?.fields.some((f) => f.field === 'type')).toBe(true)
  })

  it('CASE-iarch-032 상태를 안 읽는 종류는 모름이어도 어긋남이 아니다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'net', typeId: 'docker.network' })],
      resources: [
        live({ externalId: 'nw1', name: 'net', typeId: 'docker.network', status: 'unknown', rawStatus: '' })
      ],
      types,
      checkedTypeIds: checked
    })
    expect(rows.filter((r) => r.verdict === 'drift')).toHaveLength(0)
  })

  it('CASE-iarch-034 스냅샷이 없는 종류는 "대조 안 함" — 미구축으로 떨어지지 않는다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'srv', typeId: 'aws.ec2' })],
      resources: [],
      types,
      checkedTypeIds: checked // aws.ec2 는 이번에 안 읽었다
    })
    expect(rows[0].verdict).toBe('not-checked')
  })

  it('CASE-iarch-034 종류 없는 맨 노드도 대조 안 함으로 둔다 — 판정 근거가 없다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: '박스', typeId: null })],
      resources: [],
      types,
      checkedTypeIds: checked
    })
    expect(rows[0].verdict).toBe('not-checked')
  })

  it('CASE-iarch-035 카탈로그에 없는 종류의 실물도 표에 남는다 — 버리지 않는다', () => {
    const rows = reconcile({
      nodes: [],
      resources: [live({ externalId: 'x1', typeId: '없는종류' })],
      types,
      checkedTypeIds: new Set(['없는종류'])
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].verdict).toBe('unregistered')
    expect(rows[0].unknownType).toBe(true)
  })

  it('CASE-iarch-023 실물이 여럿 붙어도 한 줄로 보이고 개수가 남는다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [
        live({ externalId: 'c1', name: 'web' }),
        live({ externalId: 'c2', name: 'web', status: 'stopped', rawStatus: 'exited' })
      ],
      types,
      checkedTypeIds: checked
    })
    expect(rows[0].resources).toHaveLength(2)
    // 한 대라도 정상이 아니면 어긋남이다 — 죽은 한 대를 조용히 넘기지 않는다.
    expect(rows[0].verdict).toBe('drift')
  })

  it('짝짓기 근거를 결과에 실어 보낸다 — 태그와 이름은 신뢰도가 다르다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: '아무이름' })],
      resources: [live({ externalId: 'c1', designNodeRef: 'n1' })],
      types,
      checkedTypeIds: checked
    })
    expect(rows[0].basis).toBe('tag')
  })

  it('판정 순서(미구축 → 어긋남 → 미등록)로 정렬된다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'a' }), node({ id: 'n2', name: 'b' })],
      resources: [
        live({ externalId: 'c9', name: '유령' }),
        live({ externalId: 'c2', name: 'b', status: 'stopped', rawStatus: 'exited' })
      ],
      types,
      checkedTypeIds: checked
    })
    expect(rows.map((r) => r.verdict)).toEqual(['missing', 'drift', 'unregistered'])
  })

  it('빈 입력에서도 던지지 않는다', () => {
    expect(reconcile({ nodes: [], resources: [], types, checkedTypeIds: new Set() })).toEqual([])
  })
})
