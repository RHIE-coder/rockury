import type { DesignNode } from '../design/types'
import type { LiveResource, MatchBasis } from './types'

export interface Match {
  designNodeId: string
  /** 이 설계 노드에 붙은 실물들. **여럿일 수 있다**(오토스케일) — 하나로 접지 않는다. */
  resources: LiveResource[]
  basis: MatchBasis
}

export interface MatchResult {
  matches: Match[]
  /** 짝 없는 설계 노드 — '미구축' 후보. */
  unmatchedDesign: DesignNode[]
  /** 짝 없는 실물 — '미등록' 후보. */
  unmatchedLive: LiveResource[]
  /** 이름이 겹쳐 이름 짝짓기를 포기한 이름들. 화면이 "태그를 붙이세요"라고 안내하는 근거. */
  ambiguousNames: string[]
}

/**
 * 설계 노드와 실물을 짝짓는다.
 *
 * 1순위 **태그**(`rockury:node=<설계노드id>`) → 2순위 **이름**.
 * 태그로 맞은 것과 이름으로 어쩌다 맞은 것은 신뢰도가 다르므로 근거를 늘 함께 남긴다.
 *
 * 이름이 겹치면 **짝짓기를 포기한다.** 둘 중 아무 데나 붙이면 대조 결과가 조용히 틀린 답을 내고,
 * 사용자는 그걸 믿는다 — 틀린 답보다 "못 정했다"가 낫다.
 */
export function matchResources(nodes: DesignNode[], resources: LiveResource[]): MatchResult {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // 이름 → 노드들. 둘 이상이면 그 이름은 짝짓기에 못 쓴다.
  const byName = new Map<string, DesignNode[]>()
  for (const n of nodes) byName.set(n.name, [...(byName.get(n.name) ?? []), n])

  const buckets = new Map<string, { basis: MatchBasis; resources: LiveResource[] }>()
  const unmatchedLive: LiveResource[] = []
  const ambiguous = new Set<string>()

  for (const r of resources) {
    // 1순위 — 태그. 가리키는 노드가 없으면 미등록으로 떨어진다(예외로 세우지 않는다).
    if (r.designNodeRef) {
      if (byId.has(r.designNodeRef)) {
        const b = buckets.get(r.designNodeRef) ?? { basis: 'tag' as MatchBasis, resources: [] }
        b.basis = 'tag'
        b.resources.push(r)
        buckets.set(r.designNodeRef, b)
      } else {
        unmatchedLive.push(r)
      }
      continue
    }

    // 2순위 — 이름.
    const candidates = byName.get(r.name) ?? []
    if (candidates.length === 1) {
      const id = candidates[0].id
      const b = buckets.get(id) ?? { basis: 'name' as MatchBasis, resources: [] }
      b.resources.push(r)
      buckets.set(id, b)
    } else {
      if (candidates.length > 1) ambiguous.add(r.name)
      unmatchedLive.push(r)
    }
  }

  const matches: Match[] = nodes
    .filter((n) => buckets.has(n.id))
    .map((n) => {
      const b = buckets.get(n.id) as { basis: MatchBasis; resources: LiveResource[] }
      return { designNodeId: n.id, basis: b.basis, resources: b.resources }
    })

  return {
    matches,
    unmatchedDesign: nodes.filter((n) => !buckets.has(n.id)),
    unmatchedLive,
    ambiguousNames: [...ambiguous]
  }
}
