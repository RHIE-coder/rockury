import type { NodeTypeDef } from '../catalog/types'
import { docFromTemplate } from '../design/nodeDoc'
import { BOX_HEADER, BOX_PAD, DEFAULT_NODE_H, DEFAULT_NODE_W, type DesignNode } from '../design/types'
import type { DiffRow } from './diff'

/**
 * 흡수 — 대조에서 벌어진 차이를 **설계본 쪽으로 접는다.**
 *
 * DB 서비스의 Migration 과 방향이 반대다. DB 는 설계대로 실물을 고치지만, 여기서는
 * 실물 값으로 **설계본**을 고친다. Rockury 가 인프라를 구축하지 않기로 한 결정의 귀결이라,
 * 이 파일에서 나오는 어떤 값도 실물을 건드리는 지시가 되어선 안 된다.
 * (`absorb.test.ts` 가 계획 객체의 모양을 통째로 검사해 그 규칙을 기계로 지킨다.)
 */

export interface AbsorbPlan {
  /** 설계본에 새로 들어갈 노드들. */
  addNodes: DesignNode[]
  /** 기존 노드에서 바꿀 필드만. **문서는 절대 포함하지 않는다.** */
  updateNodes: { id: string; patch: Partial<DesignNode> }[]
}

export interface AbsorbInput {
  rows: DiffRow[]
  existing: DesignNode[]
  types: Record<string, NodeTypeDef>
  designId: string
  /** 그 종류가 어느 카탈로그 내용 버전에서 왔나 — 노드에 함께 남긴다. */
  catalogVersionOf: (typeId: string) => string | undefined
  /** 고른 것만 흡수한다(실물 externalId 또는 설계 노드 id). 없으면 전부. */
  only?: Set<string>
}

let seq = 0
const newId = (): string => `a${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * 무엇을 접을지 계획한다.
 *
 * **상태 어긋남은 흡수 대상이 아니다.** 컨테이너가 멈춘 것은 밖에서 고칠 일이지,
 * 설계를 "멈춰 있어야 한다"로 바꿀 일이 아니다. 접을 수 있는 것은 **구조**(종류·부모)뿐이다.
 */
export function planAbsorb(input: AbsorbInput): AbsorbPlan {
  const { rows, types, designId, catalogVersionOf, only } = input
  const picked = (key: string): boolean => !only || only.has(key)

  // 실물 externalId → 새로 만들 설계 노드 id. 부모 잇기에 쓴다.
  const idFor = new Map<string, string>()
  const unregistered = rows.filter(
    (r) => r.verdict === 'unregistered' && r.resources[0] && picked(r.resources[0].externalId)
  )
  for (const r of unregistered) idFor.set(r.resources[0].externalId, newId())

  const addNodes: DesignNode[] = unregistered.map((r) => {
    const res = r.resources[0]
    const type = types[res.typeId]
    const isBox = Boolean(type?.canContain?.length)
    return {
      id: idFor.get(res.externalId) as string,
      designId,
      typeId: res.typeId,
      name: res.name || res.externalId,
      // 부모가 이번 흡수 대상이 아니면 최상위로 둔다 — 노드를 버리는 것보다 낫다.
      parentId: (res.parentExternalId && idFor.get(res.parentExternalId)) || null,
      x: BOX_PAD,
      y: BOX_HEADER,
      w: isBox ? DEFAULT_NODE_W + BOX_PAD * 2 : DEFAULT_NODE_W,
      h: isBox ? BOX_HEADER + DEFAULT_NODE_H + BOX_PAD : DEFAULT_NODE_H,
      // 흡수로 만든 노드는 **문서가 비어 있다** — 종류의 틀만 채워지고 '설명 없음' 표식이 붙는다.
      doc: docFromTemplate(type?.docTemplate),
      catalogVersion: catalogVersionOf(res.typeId)
    }
  })

  const updateNodes: { id: string; patch: Partial<DesignNode> }[] = []
  for (const r of rows) {
    if (r.verdict !== 'drift' || !r.designNode) continue
    if (!picked(r.designNode.id)) continue
    const patch: Partial<DesignNode> = {}
    for (const f of r.fields) {
      // 상태는 접지 않는다(위 주석). 구조만 접는다.
      if (f.field === 'type' && r.resources[0]) patch.typeId = r.resources[0].typeId
    }
    if (Object.keys(patch).length > 0) updateNodes.push({ id: r.designNode.id, patch })
  }

  return { addNodes, updateNodes }
}

/**
 * 계획을 설계본에 반영한다.
 *
 * **입력 배열을 건드리지 않는다** — 부르는 쪽이 이전 배열을 그대로 들고 있으면 그것이 되돌리기다.
 */
export function applyAbsorb(nodes: DesignNode[], plan: AbsorbPlan): DesignNode[] {
  const patched = nodes.map((n) => {
    const u = plan.updateNodes.find((x) => x.id === n.id)
    return u ? { ...n, ...u.patch } : n
  })
  return [...patched, ...plan.addNodes]
}
