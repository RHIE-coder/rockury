import { describe, it, expect } from 'vitest'
import { applyAbsorb, planAbsorb } from './absorb'
import { reconcile } from './diff'
import type { LiveResource } from './types'
import { EMPTY_DOC, type NodeTypeDef } from '../catalog/types'
import type { DesignNode } from '../design/types'

const types: Record<string, NodeTypeDef> = {
  'docker.network': {
    id: 'docker.network',
    label: '네트워크',
    icon: 'phosphor:network',
    canContain: ['docker.container']
  },
  'docker.container': {
    id: 'docker.container',
    label: '컨테이너',
    icon: 'phosphor:cube',
    canNestIn: ['docker.network'],
    compareFields: ['status'],
    docTemplate: { role: '', impact: '이 컨테이너가 멈추면 무엇이 끊기나' }
  }
}

const node = (p: Partial<DesignNode> & { id: string; name: string }): DesignNode => ({
  designId: 'd1',
  typeId: 'docker.container',
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: { ...EMPTY_DOC },
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

describe('planAbsorb — 실물을 설계본으로 접기', () => {
  it('CASE-iarch-040 미등록 실물 하나를 설계 노드로 바꾼다 — 종류·이름이 옮겨진다', () => {
    const rows = reconcile({ nodes: [], resources: [live({ externalId: 'c1', name: 'web' })], types, checkedTypeIds: checked })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '2026.07.1' })
    expect(plan.addNodes).toHaveLength(1)
    expect(plan.addNodes[0]).toMatchObject({ name: 'web', typeId: 'docker.container', designId: 'd1' })
    expect(plan.addNodes[0].catalogVersion).toBe('2026.07.1')
  })

  it('CASE-iarch-041 여러 개를 한 번에 흡수해도 부모-자식 중첩이 보존된다', () => {
    const rows = reconcile({
      nodes: [],
      resources: [
        live({ externalId: 'nw1', name: 'net', typeId: 'docker.network' }),
        live({ externalId: 'c1', name: 'web', parentExternalId: 'nw1' })
      ],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    expect(plan.addNodes).toHaveLength(2)
    const net = plan.addNodes.find((n) => n.name === 'net')
    const web = plan.addNodes.find((n) => n.name === 'web')
    expect(web?.parentId).toBe(net?.id)
  })

  it('CASE-iarch-041 부모가 이번 흡수 대상이 아니면 최상위로 둔다 — 노드가 사라지지 않는다', () => {
    const rows = reconcile({
      nodes: [],
      resources: [live({ externalId: 'c1', name: 'web', parentExternalId: '어디에도없음' })],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    expect(plan.addNodes).toHaveLength(1)
    expect(plan.addNodes[0].parentId).toBeNull()
  })

  it('CASE-iarch-042 어긋남 흡수는 지정한 필드만 바꾸고 노드 문서는 건드리지 않는다', () => {
    const existing = [node({ id: 'n1', name: 'web', typeId: 'docker.network', doc: { ...EMPTY_DOC, role: '지켜야 할 설명' } })]
    const rows = reconcile({
      nodes: existing,
      resources: [live({ externalId: 'c1', name: 'web', typeId: 'docker.container' })],
      types: { ...types, 'docker.network': { ...types['docker.network'], compareFields: ['type'] } },
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing, types, designId: 'd1', catalogVersionOf: () => '1' })
    expect(plan.updateNodes).toHaveLength(1)
    expect(plan.updateNodes[0].patch.typeId).toBe('docker.container')
    expect('doc' in plan.updateNodes[0].patch).toBe(false)
  })

  it('CASE-iarch-043 계획에 실물을 바꾸는 지시가 하나도 없다 — 출력이 설계본 변경분뿐이다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [live({ externalId: 'c1', name: 'web', status: 'stopped', rawStatus: 'exited' })],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    // 구조로 못 박는다 — 나중에 누가 실행 지시 필드를 더하면 이 검사가 깨진다.
    expect(Object.keys(plan).sort()).toEqual(['addNodes', 'updateNodes'])
    const text = JSON.stringify(plan)
    for (const forbidden of ['restart', 'delete', 'stop', 'apply', 'exec', 'command', 'cmd']) {
      expect(text.toLowerCase(), `계획에 '${forbidden}' 가 들어 있다`).not.toContain(forbidden)
    }
  })

  it('CASE-iarch-043 상태 어긋남은 흡수 대상이 아니다 — 설계본으로 접을 것이 없다', () => {
    const rows = reconcile({
      nodes: [node({ id: 'n1', name: 'web' })],
      resources: [live({ externalId: 'c1', name: 'web', status: 'stopped', rawStatus: 'exited' })],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    // 컨테이너가 멈춘 것은 밖에서 고칠 일이지, 설계를 "멈춰 있어야 한다"로 바꿀 일이 아니다.
    expect(plan.updateNodes).toHaveLength(0)
    expect(plan.addNodes).toHaveLength(0)
  })

  it('CASE-iarch-045 흡수로 만든 노드는 문서가 비어 있다(종류 틀만 채워진다)', () => {
    const rows = reconcile({ nodes: [], resources: [live({ externalId: 'c1', name: 'web' })], types, checkedTypeIds: checked })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    expect(plan.addNodes[0].doc.impact).toBe('이 컨테이너가 멈추면 무엇이 끊기나')
    expect(plan.addNodes[0].doc.role).toBe('')
  })

  it('고른 것만 흡수한다 — 전부 접지 않는다', () => {
    const rows = reconcile({
      nodes: [],
      resources: [live({ externalId: 'c1', name: 'web' }), live({ externalId: 'c2', name: 'db' })],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({
      rows,
      existing: [],
      types,
      designId: 'd1',
      catalogVersionOf: () => '1',
      only: new Set(['c1'])
    })
    expect(plan.addNodes.map((n) => n.name)).toEqual(['web'])
  })
})

describe('applyAbsorb — 설계본에 반영', () => {
  it('CASE-iarch-044 되돌릴 수 있다 — 원본 배열을 건드리지 않는다', () => {
    const before = [node({ id: 'n1', name: 'keep' })]
    const rows = reconcile({ nodes: before, resources: [live({ externalId: 'c1', name: '새것' })], types, checkedTypeIds: checked })
    const plan = planAbsorb({ rows, existing: before, types, designId: 'd1', catalogVersionOf: () => '1' })
    const after = applyAbsorb(before, plan)

    expect(after).toHaveLength(2)
    expect(before).toHaveLength(1) // 원본 그대로 = 되돌리기가 성립한다
    expect(before[0].name).toBe('keep')
  })

  it('CASE-iarch-046 빈 설계본에 통째 흡수하면 중첩까지 한 번에 선다(부트스트랩)', () => {
    const rows = reconcile({
      nodes: [],
      resources: [
        live({ externalId: 'nw1', name: 'net', typeId: 'docker.network' }),
        live({ externalId: 'c1', name: 'web', parentExternalId: 'nw1' }),
        live({ externalId: 'c2', name: 'db', parentExternalId: 'nw1' })
      ],
      types,
      checkedTypeIds: checked
    })
    const plan = planAbsorb({ rows, existing: [], types, designId: 'd1', catalogVersionOf: () => '1' })
    const nodes = applyAbsorb([], plan)
    expect(nodes).toHaveLength(3)
    const net = nodes.find((n) => n.name === 'net') as DesignNode
    expect(nodes.filter((n) => n.parentId === net.id)).toHaveLength(2)
  })

  it('갱신은 지정한 필드만 덮는다', () => {
    const before = [node({ id: 'n1', name: 'web', typeId: 'docker.network' })]
    const after = applyAbsorb(before, {
      addNodes: [],
      updateNodes: [{ id: 'n1', patch: { typeId: 'docker.container' } }]
    })
    expect(after[0].typeId).toBe('docker.container')
    expect(after[0].name).toBe('web')
  })
})
