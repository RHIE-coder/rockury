import {
  STATUS_LABEL,
  type CompareField,
  type LiveResource,
  type MatchBasis,
  type ReconNode,
  type ReconType,
  type Verdict
} from '../types'
import { matchResources } from './match'

/**
 * 대조 — 설계본과 실물을 나란히 놓고 어긋난 곳을 짚는다.
 *
 * **이 함수의 출력에는 실물을 바꾸는 지시가 없다.** 무엇이 다른지 말할 뿐이고,
 * 고치는 일은 밖에서(사람 또는 에이전트) 일어난다. Rockury 쪽 반영은 흡수(`absorb.ts`)이고
 * 그건 설계본만 고친다.
 *
 * **메인·렌더러가 같은 이 함수를 부른다**(공용으로 올린 근거는 `../types.ts`) —
 * 화면과 MCP 가 다른 답을 말하면 사용자·에이전트가 어느 쪽을 믿을지 모른다.
 */

export interface DriftField {
  field: CompareField
  /** 설계가 기대하는 것. */
  design: string
  /** 실물이 그렇게 있는 것. */
  live: string
}

export interface DiffRow<N extends ReconNode = ReconNode> {
  verdict: Verdict
  designNode?: N
  resources: LiveResource[]
  basis?: MatchBasis
  fields: DriftField[]
  /** 카탈로그에 없는 종류로 읽힌 실물인가 — 버리지 않고 '미상'으로 표시한다. */
  unknownType: boolean
}

export interface ReconcileInput<N extends ReconNode = ReconNode> {
  nodes: N[]
  resources: LiveResource[]
  types: Record<string, ReconType>
  /**
   * 이번 스냅샷이 실제로 읽어 온 종류들.
   * 여기 없는 종류의 설계 노드는 **'미구축'이 아니라 '대조 안 함'** 이다 —
   * 읽지도 않고 "없다"고 말하면 사용자가 멀쩡한 인프라를 지우러 간다.
   */
  checkedTypeIds: Set<string>
}

/** 비교 필드를 선언하지 않은 종류의 기본값. 상태만 본다. */
const DEFAULT_COMPARE: CompareField[] = ['status']

/**
 * 상태 비교의 뜻: 설계본에는 런타임 상태가 없다. 설계에 그려져 있다는 것은
 * **"이게 떠 있어야 한다"** 는 뜻이므로, 실물이 정상이 아니면 어긋남으로 본다.
 */
function compare(
  node: ReconNode,
  resources: LiveResource[],
  type: ReconType | undefined
): DriftField[] {
  const fields = type?.compareFields ?? DEFAULT_COMPARE
  const out: DriftField[] = []

  if (fields.includes('status')) {
    // 상태를 아예 안 읽는 종류(탐침이 status 를 안 뽑음)는 전부 '모름'이라 판정 대상이 아니다.
    const readsStatus = resources.some((r) => r.rawStatus !== '')
    const bad = resources.filter((r) => r.status !== 'ok')
    if (readsStatus && bad.length > 0) {
      out.push({
        field: 'status',
        design: '정상이어야 함',
        live: bad
          .map((r) => `${r.name || r.externalId}: ${STATUS_LABEL[r.status]}(${r.rawStatus || '알 수 없음'})`)
          .join(' · ')
      })
    }
  }

  if (fields.includes('type')) {
    const mismatched = resources.filter((r) => node.typeId && r.typeId !== node.typeId)
    if (mismatched.length > 0) {
      out.push({
        field: 'type',
        design: node.typeId ?? '(없음)',
        live: [...new Set(mismatched.map((r) => r.typeId))].join(' · ')
      })
    }
  }

  if (fields.includes('parent')) {
    // 실물의 부모가 설계의 부모와 대응하는가. 대응 관계는 externalId ↔ 설계 노드 이름으로만 본다
    // (더 깊은 판정은 태그가 붙은 뒤에나 믿을 만하다).
    const liveParents = [...new Set(resources.map((r) => r.parentExternalId ?? ''))].filter(Boolean)
    const designHasParent = Boolean(node.parentId)
    if (designHasParent !== liveParents.length > 0) {
      out.push({
        field: 'parent',
        design: designHasParent ? '무언가에 담겨 있어야 함' : '최상위여야 함',
        live: liveParents.length > 0 ? liveParents.join(' · ') : '담긴 곳 없음'
      })
    }
  }

  return out
}

const ORDER: Record<Verdict, number> = {
  missing: 0,
  drift: 1,
  unregistered: 2,
  'not-checked': 3,
  ok: 4
}

/**
 * 대조 결과를 낸다. 셋으로 갈린다 —
 * **미구축**(설계에만) · **미등록**(실물에만) · **어긋남**(둘 다인데 다름).
 * 읽지 않은 종류는 '대조 안 함'으로 따로 둔다.
 */
export function reconcile<N extends ReconNode>(input: ReconcileInput<N>): DiffRow<N>[] {
  const { nodes, resources, types, checkedTypeIds } = input
  const { matches, unmatchedDesign, unmatchedLive } = matchResources(nodes, resources)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rows: DiffRow<N>[] = []

  for (const m of matches) {
    const node = byId.get(m.designNodeId) as N
    const type = node.typeId ? types[node.typeId] : undefined
    const fields = compare(node, m.resources, type)
    rows.push({
      verdict: fields.length > 0 ? 'drift' : 'ok',
      designNode: node,
      resources: m.resources,
      basis: m.basis,
      fields,
      unknownType: Boolean(node.typeId && !types[node.typeId])
    })
  }

  for (const node of unmatchedDesign) {
    // 이번에 읽지 않은 종류거나 종류 자체가 없으면 판정 근거가 없다.
    const checkable = Boolean(node.typeId) && checkedTypeIds.has(node.typeId as string)
    rows.push({
      verdict: checkable ? 'missing' : 'not-checked',
      designNode: node,
      resources: [],
      fields: [],
      unknownType: Boolean(node.typeId && !types[node.typeId])
    })
  }

  for (const r of unmatchedLive) {
    rows.push({
      verdict: 'unregistered',
      resources: [r],
      fields: [],
      unknownType: !types[r.typeId]
    })
  }

  return rows.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict])
}
