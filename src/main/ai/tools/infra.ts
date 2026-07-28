import { z } from 'zod'
import { listDesigns, listEdges, listNodes, listProviders } from '../../ipc/infra/store'
import { reconcileSummary } from '../../ipc/infra/reconcileMain'

/**
 * Infra 서비스가 MCP 로 여는 도구 — **읽기 전용.**
 *
 * 이것이 "Rockury 는 인프라를 구축하지 않는다"의 반대편 짝이다. 구축은 밖에서 일어나는데,
 * 에이전트가 **왜 이 노드가 있고 죽으면 무슨 일이 나는지** 모르면 아무것도 못 한다.
 * "EC2 하나 있음"을 주면 에이전트도 "그래서 어쩌라고"가 된다 — 그래서 이 도구들은
 * 이름·종류만이 아니라 **역할·영향·의존**을 함께 내보낸다.
 *
 * 실행·쓰기·자격증명 채널은 여기 없다. 앞으로도 안 연다(`coverage/infra.ts` 사유 참조).
 *
 * 서비스마다 자기 파일을 갖는다 — `tools.ts` 는 이 배열을 이어 붙이기만 하므로,
 * 다섯 서비스가 도구를 더할 때 같은 줄을 놓고 부딪히지 않는다(coverage·migrations·preload 와 같은 분할).
 */

interface InfraToolDef {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  handler: (args: Record<string, unknown>) => unknown
}

/** 저장된 문서 JSON 을 안전하게 읽는다 — 옛 형식이거나 깨져 있어도 도구가 죽지 않는다. */
function readDoc(json: string): Record<string, string> {
  try {
    const d = JSON.parse(json || '{}') as Record<string, unknown>
    const pick = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '')
    return {
      role: pick('role'),
      impact: pick('impact'),
      owner: pick('owner'),
      deps: pick('deps'),
      beforeTouch: pick('beforeTouch'),
      notes: pick('notes')
    }
  } catch {
    return { role: '', impact: '', owner: '', deps: '', beforeTouch: '', notes: '' }
  }
}

const documented = (doc: Record<string, string>): boolean =>
  Object.values(doc).some((v) => v.trim().length > 0)

export const infraToolDefs: InfraToolDef[] = [
  {
    name: 'infra_list_designs',
    description:
      'Rockury 가 들고 있는 인프라 설계본(아키텍처 도면) 목록을 반환한다 — id·이름·설명·노드 수. ' +
      'infra_get_design 의 designId 인자는 여기서 얻는다.',
    inputSchema: {},
    handler: (): unknown =>
      listDesigns().map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        nodeCount: listNodes(d.id).length
      }))
  },
  {
    name: 'infra_get_design',
    description:
      '인프라 설계본 하나를 통째로 반환한다 — 노드(종류·이름·중첩)와 연결, 그리고 각 노드의 ' +
      '**역할·영향(죽으면 무슨 일이 나나)·의존·담당·손대기 전 알 것**. ' +
      '인프라를 만들거나 고치기 전에 이걸 먼저 읽어라: 무엇이 왜 있는지가 여기 있다. ' +
      'Rockury 는 인프라를 구축하지 않으므로 실제 생성·변경은 이 정보를 근거로 밖에서 수행해야 한다.',
    inputSchema: {
      designId: z.string().describe('설계본 id (infra_list_designs 로 확인)')
    },
    handler: (args) => {
      const designId = String(args.designId ?? '')
      const design = listDesigns().find((d) => d.id === designId)
      if (!design) throw new Error(`설계본을 찾을 수 없습니다: ${designId}`)
      const nodes = listNodes(designId)
      const byId = new Map(nodes.map((n) => [n.id, n]))
      return {
        design: { id: design.id, name: design.name, description: design.description },
        nodes: nodes.map((n) => {
          const doc = readDoc(n.doc)
          return {
            id: n.id,
            name: n.name,
            type: n.typeId ?? '(종류 없음)',
            containedIn: n.parentId ? (byId.get(n.parentId)?.name ?? n.parentId) : null,
            role: doc.role,
            impact: doc.impact,
            dependsOn: doc.deps,
            owner: doc.owner,
            beforeTouch: doc.beforeTouch,
            // 설명이 비었으면 **비었다고 말한다** — 조용히 빈 문자열만 주면 에이전트가
            // "설명이 없다"와 "설명이 빈 값이다"를 구분하지 못한다.
            documented: documented(doc)
          }
        }),
        links: listEdges(designId).map((e) => ({
          from: byId.get(e.sourceId)?.name ?? e.sourceId,
          to: byId.get(e.targetId)?.name ?? e.targetId,
          label: e.label,
          kind: e.kind
        }))
      }
    }
  },
  {
    name: 'infra_get_node_doc',
    description:
      '설계 노드 하나의 문서를 전문으로 반환한다 — 정해진 칸 다섯(역할·영향·담당·의존·손대기 전 알 것)과 ' +
      '자유 서술. 특정 노드를 손대기 직전에 읽어라.',
    inputSchema: {
      designId: z.string().describe('설계본 id'),
      nodeName: z.string().describe('노드 이름 (infra_get_design 의 nodes[].name)')
    },
    handler: (args) => {
      const designId = String(args.designId ?? '')
      const nodeName = String(args.nodeName ?? '')
      const node = listNodes(designId).find((n) => n.name === nodeName)
      if (!node) throw new Error(`노드를 찾을 수 없습니다: ${nodeName}`)
      const doc = readDoc(node.doc)
      return {
        name: node.name,
        type: node.typeId ?? '(종류 없음)',
        catalogVersion: node.catalogVersion,
        ...doc,
        documented: documented(doc)
      }
    }
  },
  {
    name: 'infra_get_reconcile',
    description:
      '설계본과 **마지막으로 읽어 온 실물**을 견준 결과를 반환한다 — 미구축(설계에만 있음) · ' +
      '미등록(실물에만 있음) · 어긋남(둘 다 있는데 다름) · 대조 안 함(안 읽어서 판정 불가). ' +
      '어긋남은 **어느 필드가 어떻게 다른지** 필드 단위로 담긴다. ' +
      '언제 기준인지(snapshotTakenAt)가 함께 오므로 오래된 값을 방금 것으로 오해하지 마라. ' +
      '**Rockury 는 인프라를 구축하지 않는다** — 이 결과를 근거로 고치는 일은 밖에서 해야 하고, ' +
      '이 도구로는 아무것도 바뀌지 않는다. 실물을 안 읽었으면 미구축이 아니라 "대조 안 함"으로 나온다.',
    inputSchema: {
      designId: z.string().describe('설계본 id (infra_list_designs 로 확인)'),
      providerId: z
        .string()
        .optional()
        .describe('공급자 연결 id. 없으면 연결이 하나일 때만 그것으로 견준다')
    },
    handler: (args) => {
      const designId = String(args.designId ?? '')
      if (!listDesigns().some((d) => d.id === designId)) {
        throw new Error(`설계본을 찾을 수 없습니다: ${designId}`)
      }
      const providers = listProviders()
      const given = args.providerId ? String(args.providerId) : ''
      if (!given && providers.length !== 1) {
        // 연결이 여럿인데 아무거나 고르면 엉뚱한 인프라와 견준 답을 내놓게 된다 — 그건 틀린 답이다.
        throw new Error(
          providers.length === 0
            ? '공급자 연결이 없습니다 — 견줄 실물이 없습니다.'
            : `공급자 연결이 ${providers.length}개입니다. providerId 를 지정하세요.`
        )
      }
      return reconcileSummary(designId, given || providers[0].id)
    }
  }
]
