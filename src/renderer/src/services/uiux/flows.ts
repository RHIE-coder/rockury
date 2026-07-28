import type { SpecTree } from './store'
import { parseContent } from './content'
import type { DataOp, NavKind, SurfaceEvent } from './types'

/**
 * 흐름 — 명세 정본 `docs/spec/uiux-ia.md` §3.
 *
 * 이벤트는 **트리거 하나 + 효과 여럿**이다. 화면 전이와 데이터 변이를 갈래로 나누지 않는다 —
 * 삭제 버튼 한 번이 모달을 닫고 + 상품을 지우는데, 갈래를 나누면 같은 클릭이 두 군데로 찢어진다.
 *
 * 이벤트는 각 화면 안(`content.events`)에 산다(**분산 선언**). 여기서 하는 일은 그것을 모아
 * 그래프로 세우는 것뿐 — 중앙 목록을 따로 두면 화면을 지웠을 때 그 목록만 낡는다.
 */

/** 그래프의 한 화면. */
export interface FlowNode {
  surfaceId: string
  address: string
  name: string
  kind: string
  /** 진입점에서 몇 걸음인가 — 세로 줄(레이어)을 정한다. */
  depth: number
  /** 같은 줄 안에서 몇 번째인가. */
  order: number
}

/** 화살표 하나 — 이벤트의 효과 하나에 해당한다. */
export interface FlowEdge {
  id: string
  from: string
  to: string
  /** 화면 전이면 어떻게(이동/열기/닫기), 데이터 변이면 무엇을. */
  kind: 'nav' | 'data'
  label: string
  navKind?: NavKind
  op?: DataOp
  contract?: string
  /** 가리키는 화면이 없다 — 오타이거나 지워진 화면(조용히 감추면 영영 못 찾는다). */
  dangling?: boolean
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** 아무 화면에서도 닿을 수 없는 화면 — 링크가 빠졌다는 신호. */
  unreachable: string[]
}

const NAV_LABEL: Record<NavKind, string> = { navigate: '이동', open: '열기', close: '닫기' }
const OP_LABEL: Record<DataOp, string> = { create: '만들기', update: '고치기', delete: '지우기' }

/** 화면 하나의 이벤트를 안전하게 읽는다 — 내용이 깨져도 그래프 전체가 무너지지 않게. */
export function surfaceEvents(contentJson: string): SurfaceEvent[] {
  return parseContent(contentJson).events ?? []
}

/**
 * 트리 → 그래프. 주소는 화면을 가리키는 유일한 이름이라 간선의 출발·도착 모두 주소로 잇는다.
 *
 * **가리키는 화면이 없어도 화살표를 지우지 않는다** — 오타나 지워진 화면을 조용히 감추면
 * "왜 안 이어지지?"를 영영 못 찾는다. 대신 끊긴 것으로 표시한다.
 */
export function buildGraph(tree: SpecTree, projectKey: string): FlowGraph {
  const addressOf = new Map<string, string>()
  const byAddress = new Map<string, { id: string; name: string; kind: string }>()

  for (const surface of tree.surfaces) {
    const service = tree.services.find((s) => s.id === surface.service_id)
    const app = service && tree.applications.find((a) => a.id === service.application_id)
    if (!service || !app) continue
    const address = `${projectKey}.${app.key}.${service.key}.${surface.key}`
    addressOf.set(surface.id, address)
    byAddress.set(address, { id: surface.id, name: surface.name, kind: surface.kind })
  }

  const edges: FlowEdge[] = []
  for (const surface of tree.surfaces) {
    const from = addressOf.get(surface.id)
    if (!from) continue
    surfaceEvents(surface.content).forEach((event, index) => {
      const trigger = event.trigger?.component ?? event.trigger?.schedule ?? ''
      const base = event.label || trigger || '이벤트'
      if (event.nav?.to) {
        const navKind = event.nav.kind ?? 'navigate'
        edges.push({
          id: `${surface.id}:${index}:nav`,
          from,
          to: event.nav.to,
          kind: 'nav',
          navKind,
          label: event.nav.label || `${base} · ${NAV_LABEL[navKind]}`,
          dangling: !byAddress.has(event.nav.to)
        })
      }
      if (event.data?.contract) {
        edges.push({
          id: `${surface.id}:${index}:data`,
          from,
          to: from,
          kind: 'data',
          op: event.data.op,
          contract: event.data.contract,
          label: event.data.label || `${event.data.contract} ${OP_LABEL[event.data.op] ?? event.data.op}`
        })
      }
    })
  }

  const nodes = layout([...byAddress.entries()].map(([address, v]) => ({ address, ...v })), edges)
  const reachable = reachableFrom(nodes, edges)
  return {
    nodes,
    edges,
    unreachable: nodes.filter((n) => !reachable.has(n.address)).map((n) => n.address)
  }
}

/**
 * 계층 배치 — 들어오는 화살표가 없는 화면(진입점)을 첫 줄에 두고, 거기서 몇 걸음인지로 줄을 가른다.
 * 순환이 있어도 멈춘다(이미 자리를 잡은 화면은 다시 밀지 않는다).
 *
 * 좌표를 여기서 정하지 않는 이유: 화면 크기·여백은 그리는 쪽 사정이고, 여기서 정하면
 * 배치 규칙을 바꿀 때마다 이 순수 함수를 건드려야 한다. 줄과 차례만 준다.
 */
function layout(
  surfaces: { address: string; id: string; name: string; kind: string }[],
  edges: FlowEdge[]
): FlowNode[] {
  const incoming = new Map<string, number>()
  for (const s of surfaces) incoming.set(s.address, 0)
  for (const e of edges) {
    if (e.kind !== 'nav' || e.dangling || e.from === e.to) continue
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  }

  const depth = new Map<string, number>()
  // 진입점이 하나도 없으면(전부 순환) 첫 화면을 진입점으로 삼는다 — 아무것도 안 그리는 것보다 낫다.
  const roots = surfaces.filter((s) => (incoming.get(s.address) ?? 0) === 0)
  const queue = (roots.length > 0 ? roots : surfaces.slice(0, 1)).map((s) => s.address)
  for (const address of queue) depth.set(address, 0)

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    const next = depth.get(current)! + 1
    for (const e of edges) {
      if (e.kind !== 'nav' || e.dangling || e.from !== current || e.to === current) continue
      if (depth.has(e.to)) continue
      depth.set(e.to, next)
      queue.push(e.to)
    }
  }

  // 어디서도 안 닿는 화면은 맨 끝 줄에 모은다 — 안 보이면 빠졌다는 사실도 안 보인다.
  const maxDepth = Math.max(0, ...[...depth.values()])
  const orderIn = new Map<number, number>()
  return surfaces.map((s) => {
    const d = depth.get(s.address) ?? maxDepth + 1
    const order = orderIn.get(d) ?? 0
    orderIn.set(d, order + 1)
    return { surfaceId: s.id, address: s.address, name: s.name, kind: s.kind, depth: d, order }
  })
}

/** 진입점(들어오는 전이가 없는 화면)에서 화살표를 타고 닿는 화면 전부. */
function reachableFrom(nodes: FlowNode[], edges: FlowEdge[]): Set<string> {
  const seen = new Set<string>()
  const stack = nodes.filter((n) => n.depth === 0).map((n) => n.address)
  for (const address of stack) seen.add(address)
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const e of edges) {
      if (e.kind !== 'nav' || e.dangling || e.from !== current || seen.has(e.to)) continue
      seen.add(e.to)
      stack.push(e.to)
    }
  }
  return seen
}
