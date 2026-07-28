import { create } from 'zustand'
import { BUILTIN_CATALOGS } from './catalog/builtin'
import { parseCatalog, serializeCatalog } from './catalog/schema'
import { cloneAsMine, newUserCatalog, upsertNodeType } from './catalog/userCatalog'
import type { Catalog, CatalogSource, NodeTypeDef } from './catalog/types'
import { extractNodes, parseResponse } from './catalog/extract'
import { docFromTemplate, normalizeDoc } from './design/nodeDoc'
import { applyAbsorb, planAbsorb } from './reconcile/absorb'
import { reconcile, type DiffRow } from './reconcile/diff'
import type { LiveResource } from './reconcile/types'
import { canNest, descendantIds, fitParentSize, wouldCycle } from './design/nesting'
import { layoutNested } from './design/layout'
import {
  BOX_HEADER,
  BOX_PAD,
  DEFAULT_NODE_H,
  DEFAULT_NODE_W,
  type DesignEdge,
  type DesignNode
} from './design/types'
import type { NodeDoc } from './catalog/types'

/**
 * 공급자 연결의 화면용 모양 — 메인이 주는 것과 같은 구조다(비밀은 담기지 않는다).
 * 렌더러는 preload 를 직접 import 하지 않는 게 이 저장소 관례라 여기에 다시 적는다.
 */
export interface ProviderPublic {
  id: string
  catalogId: string
  name: string
  readOnly: boolean
  hasCredentials: boolean
}

/**
 * Infra 서비스 화면 상태.
 *
 * 규칙은 전부 도메인 모듈(`catalog/` · `design/`)에 있고 여기는 그것을 부르는 자리다 —
 * 중첩 판정·문서 판정이 화면마다 흩어지면 새 진입 경로가 규칙을 우회한다.
 */

export interface StoredCatalog {
  id: string
  source: CatalogSource
  catalog: Catalog
}

/** 화면이 보는 스냅샷 요약 — "○분 전 기준"과 탐침별 성패. */
export interface SnapshotSummary {
  providerId: string
  takenAt: string
  ok: boolean
  probes: { typeId: string; ok: boolean; count: number; error: string }[]
  resources: LiveResource[]
}

/** 이번 스냅샷이 **실제로 읽어 온** 종류들. 여기 없으면 '대조 안 함'이다. */
export function checkedTypesOf(snapshot: SnapshotSummary | null): Set<string> {
  return new Set((snapshot?.probes ?? []).filter((p) => p.ok).map((p) => p.typeId))
}

interface InfraState {
  loaded: boolean
  catalogs: StoredCatalog[]
  providers: ProviderPublic[]
  designs: { id: string; name: string; description: string }[]
  activeDesignId: string | null
  nodes: DesignNode[]
  edges: DesignEdge[]
  selectedNodeId: string | null
  /** 저장 안 된 변경이 있나 — 화면이 "저장" 버튼을 켜는 근거. */
  dirty: boolean
  lastError: string | null

  /** 지금 보고 있는 공급자와 그 최신 스냅샷. */
  activeProviderId: string | null
  snapshot: SnapshotSummary | null
  syncing: boolean
  /** 흡수 직전 설계본 — 되돌리기용. null 이면 되돌릴 것이 없다. */
  beforeAbsorb: DesignNode[] | null

  init: () => Promise<void>
  reloadCatalogs: () => Promise<void>
  reloadProviders: () => Promise<void>

  /** 탐침 편집기가 만든 종류를 사용자 카탈로그에 저장한다. 새 카탈로그면 만들어서 넣는다. */
  saveNodeType: (input: {
    catalogId: string | null
    providerId: string
    providerLabel: string
    type: NodeTypeDef
  }) => Promise<void>
  /** 검증을 통과한 카탈로그만 들여온다. 실패하면 사유를 돌려준다(저장하지 않는다). */
  importCatalog: (raw: unknown) => Promise<{ ok: true } | { ok: false; errors: string[] }>
  cloneCatalog: (catalogId: string, providerId: string, label: string) => Promise<void>
  removeCatalog: (catalogId: string) => Promise<void>

  selectDesign: (id: string) => Promise<void>
  createDesign: (name: string) => Promise<string>
  removeDesign: (id: string) => Promise<void>
  save: () => Promise<void>

  /** 공급자 하나를 읽어 스냅샷으로 저장한다. 일부 탐침이 실패해도 성공분은 반영한다. */
  syncProvider: (providerId: string) => Promise<void>
  loadSnapshot: (providerId: string) => Promise<void>
  /** 대조 결과를 설계본으로 접는다. 실물은 건드리지 않는다. */
  absorb: (only?: Set<string>) => void
  /** 직전 흡수를 되돌린다. */
  undoAbsorb: () => void

  addNode: (typeId: string | null, at?: { x: number; y: number }) => string
  renameNode: (id: string, name: string) => void
  moveNode: (id: string, x: number, y: number) => void
  reparentNode: (id: string, parentId: string | null) => { ok: boolean; reason?: string }
  removeNode: (id: string) => void
  setDoc: (id: string, doc: NodeDoc) => void
  select: (id: string | null) => void
  addEdge: (sourceId: string, targetId: string) => void
  removeEdge: (id: string) => void
  autoLayout: () => void
}

/** 카탈로그 전부에서 종류 지도를 만든다. 같은 id 가 겹치면 나중 것이 이긴다(사용자 것이 내장을 덮는다). */
export function typesOf(catalogs: StoredCatalog[]): Record<string, NodeTypeDef> {
  const out: Record<string, NodeTypeDef> = {}
  const order: CatalogSource[] = ['builtin', 'imported', 'mine']
  const sorted = [...catalogs].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))
  for (const c of sorted) for (const t of c.catalog.nodeTypes) out[t.id] = t
  return out
}

/** 어느 카탈로그에서 온 종류인지 — 화면이 출처 배지를 붙이는 근거. */
export function sourceOfType(catalogs: StoredCatalog[], typeId: string): CatalogSource | null {
  for (const c of catalogs) {
    if (c.catalog.nodeTypes.some((t) => t.id === typeId)) return c.source
  }
  return null
}

const builtinAsStored = (): StoredCatalog[] =>
  BUILTIN_CATALOGS.map((b) => ({ id: b.id, source: 'builtin' as const, catalog: b.catalog }))

let seq = 0
const newId = (): string => `n${Date.now().toString(36)}${(seq++).toString(36)}`

export const useInfraStore = create<InfraState>()((set, get) => ({
  loaded: false,
  catalogs: builtinAsStored(),
  providers: [],
  designs: [],
  activeDesignId: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  lastError: null,
  activeProviderId: null,
  snapshot: null,
  syncing: false,
  beforeAbsorb: null,

  init: async () => {
    await Promise.all([get().reloadCatalogs(), get().reloadProviders()])
    const designs = await window.rockury.infra.listDesigns()
    set({ designs, loaded: true })
    if (designs.length > 0) await get().selectDesign(designs[0].id)
  },

  reloadCatalogs: async () => {
    const rows = await window.rockury.infra.listCatalogs()
    const user: StoredCatalog[] = []
    for (const r of rows) {
      // 저장된 것도 다시 검증한다 — 앱을 업데이트해 형식이 바뀌면 옛 파일이 조용히 깨질 수 있다.
      const parsed = parseCatalog(JSON.parse(r.body) as unknown)
      if (parsed.ok) user.push({ id: r.id, source: r.source, catalog: parsed.catalog })
    }
    set({ catalogs: [...builtinAsStored(), ...user] })
  },

  reloadProviders: async () => {
    set({ providers: await window.rockury.infra.listProviders() })
  },

  saveNodeType: async ({ catalogId, providerId, providerLabel, type }) => {
    const existing = catalogId ? get().catalogs.find((c) => c.id === catalogId) : null
    if (existing && existing.source === 'builtin') {
      throw new Error('내장 카탈로그에는 넣을 수 없습니다. 복제한 뒤 넣으세요.')
    }
    const next = existing
      ? upsertNodeType(existing.catalog, type)
      : newUserCatalog(providerId, providerLabel, [type])
    // 사용자가 만든 것도 남에게서 가져온 것과 **똑같은 검증**을 거친다.
    const parsed = parseCatalog(next)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    await window.rockury.infra.saveCatalog({
      id: existing?.id,
      source: 'mine',
      providerId: parsed.catalog.provider.id,
      schemaVersion: parsed.catalog.schemaVersion,
      catalogVersion: parsed.catalog.catalogVersion,
      body: serializeCatalog(parsed.catalog)
    })
    await get().reloadCatalogs()
  },

  importCatalog: async (raw) => {
    const parsed = parseCatalog(raw)
    if (!parsed.ok) return { ok: false, errors: parsed.errors }
    await window.rockury.infra.saveCatalog({
      source: 'imported',
      providerId: parsed.catalog.provider.id,
      schemaVersion: parsed.catalog.schemaVersion,
      catalogVersion: parsed.catalog.catalogVersion,
      body: serializeCatalog(parsed.catalog),
      approvedAt: new Date().toISOString()
    })
    await get().reloadCatalogs()
    return { ok: true }
  },

  cloneCatalog: async (catalogId, providerId, label) => {
    const src = get().catalogs.find((c) => c.id === catalogId)
    if (!src) throw new Error('복제할 카탈로그를 찾을 수 없습니다.')
    const copy = cloneAsMine(src.catalog, providerId, label)
    const parsed = parseCatalog(copy)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    await window.rockury.infra.saveCatalog({
      source: 'mine',
      providerId: parsed.catalog.provider.id,
      schemaVersion: parsed.catalog.schemaVersion,
      catalogVersion: parsed.catalog.catalogVersion,
      body: serializeCatalog(parsed.catalog)
    })
    await get().reloadCatalogs()
  },

  removeCatalog: async (catalogId) => {
    await window.rockury.infra.deleteCatalog(catalogId)
    await get().reloadCatalogs()
  },

  selectDesign: async (id) => {
    const graph = await window.rockury.infra.getGraph(id)
    set({
      activeDesignId: id,
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        designId: id,
        typeId: n.typeId,
        name: n.name,
        parentId: n.parentId,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        doc: normalizeDoc(JSON.parse(n.doc || '{}') as unknown),
        catalogVersion: n.catalogVersion ?? undefined
      })),
      edges: graph.edges.map((e) => ({ ...e, designId: id })),
      selectedNodeId: null,
      dirty: false
    })
  },

  createDesign: async (name) => {
    const d = await window.rockury.infra.createDesign({ name })
    set({ designs: [...get().designs, d] })
    await get().selectDesign(d.id)
    return d.id
  },

  removeDesign: async (id) => {
    await window.rockury.infra.deleteDesign(id)
    const designs = get().designs.filter((d) => d.id !== id)
    set({ designs })
    if (get().activeDesignId === id) {
      if (designs.length) await get().selectDesign(designs[0].id)
      else set({ activeDesignId: null, nodes: [], edges: [] })
    }
  },

  save: async () => {
    const { activeDesignId, nodes, edges } = get()
    if (!activeDesignId) return
    try {
      await window.rockury.infra.saveGraph(
        activeDesignId,
        nodes.map((n) => ({
          id: n.id,
          typeId: n.typeId,
          name: n.name,
          parentId: n.parentId,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          doc: JSON.stringify(n.doc),
          catalogVersion: n.catalogVersion ?? null
        })),
        edges.map((e) => ({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          label: e.label,
          kind: e.kind
        }))
      )
      set({ dirty: false, lastError: null })
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  syncProvider: async (providerId) => {
    const { catalogs } = get()
    const provider = get().providers.find((p) => p.id === providerId)
    const catalog = catalogs.find((c) => c.id === provider?.catalogId)
    if (!catalog) {
      set({ lastError: '이 연결의 카탈로그를 찾을 수 없습니다.' })
      return
    }
    set({ syncing: true, activeProviderId: providerId, lastError: null })

    const probes: { typeId: string; ok: boolean; count: number; error: string }[] = []
    const resources: LiveResource[] = []

    for (const type of catalog.catalog.nodeTypes) {
      const d = type.discover
      if (!d) continue // 프리셋 — 읽을 것이 없다
      if (d.call.type !== 'cli') {
        probes.push({ typeId: type.id, ok: false, count: 0, error: '아직 CLI 탐침만 실행합니다.' })
        continue
      }
      try {
        const out = await window.rockury.infra.runProbe({
          providerId,
          cmd: d.call.cmd,
          args: d.call.args
        })
        if (!out.ok) {
          // **일부가 실패해도 나머지는 계속 읽는다** — 전부 실패로 뭉개면 멀쩡히 읽은 것까지 사라진다.
          probes.push({
            typeId: type.id,
            ok: false,
            count: 0,
            error: out.timedOut ? '시간 초과' : (out.error ?? out.stderr.slice(0, 200))
          })
          continue
        }
        const parsed = parseResponse(out.stdout, d.format)
        if (parsed.error) {
          probes.push({ typeId: type.id, ok: false, count: 0, error: parsed.error })
          continue
        }
        const got = extractNodes(d, parsed.data)
        if (got.error) {
          probes.push({ typeId: type.id, ok: false, count: 0, error: got.error })
          continue
        }
        for (const n of got.nodes) {
          resources.push({
            externalId: n.externalId,
            typeId: type.id,
            name: n.name ?? n.externalId,
            status: n.status,
            rawStatus: n.rawStatus,
            parentExternalId: n.parentExternalId,
            designNodeRef: n.designNodeRef
          })
        }
        probes.push({ typeId: type.id, ok: true, count: got.nodes.length, error: '' })
      } catch (e) {
        probes.push({
          typeId: type.id,
          ok: false,
          count: 0,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }

    try {
      const saved = await window.rockury.infra.saveSnapshot({
        providerId,
        probes,
        resources: resources.map((r) => ({
          typeId: r.typeId,
          externalId: r.externalId,
          name: r.name,
          status: r.status,
          rawStatus: r.rawStatus,
          parentExternalId: r.parentExternalId ?? null,
          designNodeRef: r.designNodeRef ?? null
        }))
      })
      set({ snapshot: toSummary(saved), syncing: false })
    } catch (e) {
      set({ syncing: false, lastError: e instanceof Error ? e.message : String(e) })
    }
  },

  loadSnapshot: async (providerId) => {
    const snap = await window.rockury.infra.latestSnapshot(providerId)
    set({ activeProviderId: providerId, snapshot: snap ? toSummary(snap) : null })
  },

  absorb: (only) => {
    const { nodes, catalogs, activeDesignId, snapshot } = get()
    const types = typesOf(catalogs)
    const rows = reconcile({
      nodes,
      resources: snapshot?.resources ?? [],
      types,
      checkedTypeIds: checkedTypesOf(snapshot)
    })
    const plan = planAbsorb({
      rows,
      existing: nodes,
      types,
      designId: activeDesignId ?? '',
      catalogVersionOf: (typeId) =>
        catalogs.find((c) => c.catalog.nodeTypes.some((t) => t.id === typeId))?.catalog.catalogVersion,
      only
    })
    if (plan.addNodes.length === 0 && plan.updateNodes.length === 0) return
    // 되돌리기를 위해 이전 배열을 그대로 보관한다(applyAbsorb 가 입력을 건드리지 않는다).
    set({ beforeAbsorb: nodes, nodes: growParents(applyAbsorb(nodes, plan)), dirty: true })
  },

  undoAbsorb: () => {
    const before = get().beforeAbsorb
    if (!before) return
    set({ nodes: before, beforeAbsorb: null, dirty: true })
  },

  addNode: (typeId, at) => {
    const { activeDesignId, catalogs } = get()
    const types = typesOf(catalogs)
    const type = typeId ? types[typeId] : undefined
    const id = newId()
    // 종류가 담을 수 있는 것이면 처음부터 상자 크기로 놓는다 — 안에 뭘 넣으려다 좁아서 못 넣는 일을 없앤다.
    const isBox = Boolean(type?.canContain?.length)
    const node: DesignNode = {
      id,
      designId: activeDesignId ?? '',
      typeId,
      name: type?.label ?? '새 노드',
      parentId: null,
      x: at?.x ?? 40,
      y: at?.y ?? 40,
      w: isBox ? DEFAULT_NODE_W + BOX_PAD * 2 : DEFAULT_NODE_W,
      h: isBox ? BOX_HEADER + DEFAULT_NODE_H + BOX_PAD : DEFAULT_NODE_H,
      doc: docFromTemplate(type?.docTemplate),
      catalogVersion: typeId
        ? catalogs.find((c) => c.catalog.nodeTypes.some((t) => t.id === typeId))?.catalog.catalogVersion
        : undefined
    }
    set({ nodes: [...get().nodes, node], selectedNodeId: id, dirty: true })
    return id
  },

  renameNode: (id, name) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, name } : n)), dirty: true }),

  moveNode: (id, x, y) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, x, y } : n)), dirty: true }),

  reparentNode: (id, parentId) => {
    const { nodes, catalogs } = get()
    const node = nodes.find((n) => n.id === id)
    if (!node) return { ok: false, reason: '노드를 찾을 수 없습니다.' }
    if (wouldCycle(nodes, id, parentId)) {
      return { ok: false, reason: '자기 자신이나 자기 안의 노드를 부모로 삼을 수 없습니다.' }
    }
    const parent = parentId ? nodes.find((n) => n.id === parentId) : null
    const check = canNest(node.typeId, parent?.typeId ?? null, typesOf(catalogs))
    if (!check.ok) return { ok: false, reason: check.reason }

    const next = nodes.map((n) => (n.id === id ? { ...n, parentId, x: BOX_PAD, y: BOX_HEADER } : n))
    set({ nodes: growParents(next), dirty: true })
    return { ok: true }
  },

  removeNode: (id) => {
    const { nodes, edges } = get()
    // 자손도 함께 지운다 — 부모만 지우면 자식이 갈 곳 없는 참조로 남는다.
    const doomed = descendantIds(nodes, id)
    set({
      nodes: nodes.filter((n) => !doomed.has(n.id)),
      edges: edges.filter((e) => !doomed.has(e.sourceId) && !doomed.has(e.targetId)),
      selectedNodeId: null,
      dirty: true
    })
  },

  setDoc: (id, doc) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, doc } : n)), dirty: true }),

  select: (id) => set({ selectedNodeId: id }),

  addEdge: (sourceId, targetId) => {
    if (sourceId === targetId) return
    const exists = get().edges.some((e) => e.sourceId === sourceId && e.targetId === targetId)
    if (exists) return
    set({
      edges: [
        ...get().edges,
        {
          id: newId(),
          designId: get().activeDesignId ?? '',
          sourceId,
          targetId,
          label: '',
          kind: 'calls'
        }
      ],
      dirty: true
    })
  },

  removeEdge: (id) => set({ edges: get().edges.filter((e) => e.id !== id), dirty: true }),

  autoLayout: () => {
    const { nodes, edges } = get()
    const boxes = layoutNested(
      nodes.map((n) => ({ id: n.id, parentId: n.parentId, w: n.w, h: n.h })),
      edges.map((e) => ({ source: e.sourceId, target: e.targetId }))
    )
    set({
      nodes: nodes.map((n) => {
        const b = boxes[n.id]
        return b ? { ...n, x: b.x, y: b.y, w: b.w, h: b.h } : n
      }),
      dirty: true
    })
  }
}))

/** 저장소 레코드를 화면이 보는 요약으로. 상태 문자열은 그대로 통과시킨다(사전은 이미 거쳤다). */
function toSummary(snap: {
  providerId: string
  takenAt: string
  ok: boolean
  probes: { typeId: string; ok: boolean; count: number; error: string }[]
  resources: {
    typeId: string
    externalId: string
    name: string
    status: string
    rawStatus: string
    parentExternalId: string | null
    designNodeRef: string | null
  }[]
}): SnapshotSummary {
  return {
    providerId: snap.providerId,
    takenAt: snap.takenAt,
    ok: snap.ok,
    probes: snap.probes,
    resources: snap.resources.map((r) => ({
      typeId: r.typeId,
      externalId: r.externalId,
      name: r.name,
      status: r.status as LiveResource['status'],
      rawStatus: r.rawStatus,
      parentExternalId: r.parentExternalId ?? undefined,
      designNodeRef: r.designNodeRef ?? undefined
    }))
  }
}

/** 지금 설계본과 최신 스냅샷으로 대조 결과를 낸다 — 화면 둘이 같은 계산을 본다. */
export function reconcileRows(state: {
  nodes: DesignNode[]
  catalogs: StoredCatalog[]
  snapshot: SnapshotSummary | null
}): DiffRow[] {
  return reconcile({
    nodes: state.nodes,
    resources: state.snapshot?.resources ?? [],
    types: typesOf(state.catalogs),
    checkedTypeIds: checkedTypesOf(state.snapshot)
  })
}

/** 자식이 늘거나 옮겨진 뒤 부모 상자를 다시 키운다(가장 깊은 곳부터 위로). */
export function growParents(nodes: DesignNode[]): DesignNode[] {
  const childrenOf = new Map<string, DesignNode[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n])
  }
  const depth = (n: DesignNode): number => {
    let d = 0
    let cur = n.parentId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      d++
      cur = nodes.find((x) => x.id === cur)?.parentId ?? null
    }
    return d
  }
  const byDepthDesc = [...nodes].sort((a, b) => depth(b) - depth(a))
  const sized = new Map(nodes.map((n) => [n.id, n]))
  for (const n of byDepthDesc) {
    const kids = (childrenOf.get(n.id) ?? []).map((k) => sized.get(k.id) as DesignNode)
    if (kids.length === 0) continue
    const size = fitParentSize(kids)
    sized.set(n.id, { ...(sized.get(n.id) as DesignNode), w: size.w, h: size.h })
  }
  return nodes.map((n) => sized.get(n.id) as DesignNode)
}
