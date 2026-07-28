import { describe, it, expect } from 'vitest'
import { matchResources } from './match'
import type { LiveResource } from './types'
import { EMPTY_DOC } from '../catalog/types'
import type { DesignNode } from '../design/types'

const node = (id: string, name: string, typeId: string | null = 'docker.container'): DesignNode => ({
  id,
  designId: 'd1',
  typeId,
  name,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 60,
  doc: { ...EMPTY_DOC }
})

const live = (p: Partial<LiveResource> & { externalId: string }): LiveResource => ({
  typeId: 'docker.container',
  name: p.externalId,
  status: 'ok',
  rawStatus: 'running',
  ...p
})

describe('matchResources — 짝짓기', () => {
  it('CASE-iarch-020 태그가 있으면 그것으로 짝짓고 근거를 태그로 남긴다', () => {
    const r = matchResources([node('n1', '전혀-다른-이름')], [live({ externalId: 'c1', designNodeRef: 'n1' })])
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].designNodeId).toBe('n1')
    expect(r.matches[0].basis).toBe('tag')
    expect(r.unmatchedDesign).toHaveLength(0)
    expect(r.unmatchedLive).toHaveLength(0)
  })

  it('CASE-iarch-021 태그가 없으면 이름으로 짝짓고 근거를 이름으로 남긴다', () => {
    const r = matchResources([node('n1', 'web')], [live({ externalId: 'c1', name: 'web' })])
    expect(r.matches[0].basis).toBe('name')
  })

  it('CASE-iarch-022 태그 짝이 있으면 이름 짝은 보지 않는다 — 1순위 우선', () => {
    const nodes = [node('n1', 'web'), node('n2', 'db')]
    // 이름은 'web' 이지만 태그는 n2 를 가리킨다 → 태그가 이긴다.
    const r = matchResources(nodes, [live({ externalId: 'c1', name: 'web', designNodeRef: 'n2' })])
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].designNodeId).toBe('n2')
    expect(r.matches[0].basis).toBe('tag')
    expect(r.unmatchedDesign.map((n) => n.id)).toEqual(['n1'])
  })

  it('CASE-iarch-023 한 설계 노드에 실물이 여럿이면 전부 유지한다 — 하나로 접지 않는다(오토스케일)', () => {
    const r = matchResources(
      [node('n1', 'web')],
      [live({ externalId: 'c1', name: 'web' }), live({ externalId: 'c2', name: 'web' })]
    )
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].resources.map((x) => x.externalId)).toEqual(['c1', 'c2'])
  })

  it('CASE-iarch-024 없어진 설계 노드를 가리키는 태그는 미등록으로 떨어진다(예외가 되지 않는다)', () => {
    const r = matchResources([node('n1', 'web')], [live({ externalId: 'c1', designNodeRef: '없는노드' })])
    expect(r.unmatchedLive.map((x) => x.externalId)).toEqual(['c1'])
    expect(r.unmatchedDesign.map((n) => n.id)).toEqual(['n1'])
  })

  it('짝 없는 설계 노드와 짝 없는 실물이 각각 남는다', () => {
    const r = matchResources(
      [node('n1', 'web'), node('n2', 'cache')],
      [live({ externalId: 'c1', name: 'web' }), live({ externalId: 'c9', name: '유령' })]
    )
    expect(r.matches.map((m) => m.designNodeId)).toEqual(['n1'])
    expect(r.unmatchedDesign.map((n) => n.id)).toEqual(['n2'])
    expect(r.unmatchedLive.map((x) => x.externalId)).toEqual(['c9'])
  })

  it('같은 이름의 설계 노드가 둘이면 이름 짝짓기를 포기한다 — 아무 데나 붙이지 않는다', () => {
    const r = matchResources(
      [node('n1', 'web'), node('n2', 'web')],
      [live({ externalId: 'c1', name: 'web' })]
    )
    expect(r.matches).toHaveLength(0)
    expect(r.unmatchedLive).toHaveLength(1)
    expect(r.ambiguousNames).toEqual(['web'])
  })

  it('빈 입력에서도 던지지 않는다', () => {
    expect(matchResources([], [])).toMatchObject({ matches: [], unmatchedDesign: [], unmatchedLive: [] })
  })
})
