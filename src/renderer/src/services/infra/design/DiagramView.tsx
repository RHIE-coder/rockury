import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@renderer/ui/button'
import { Input } from '@renderer/ui/input'
import { cn } from '@renderer/lib/utils'
import { InfraIcon } from '../catalog/iconMap'
import { isDocEmpty } from './nodeDoc'
import { InfraNode, type InfraNodeData } from './InfraNode'
import { growParents, typesOf, useInfraStore } from '../store'
import type { DesignNode } from './types'

const nodeTypes = { infra: InfraNode }

/**
 * 설계본 캔버스.
 *
 * 좌표를 **부모 기준 상대값**으로 들고 있어(@xyflow 규약) 부모를 옮기면 자식이 코드 없이 따라온다.
 * 중첩 허가는 `canNest` 한 곳에서만 판정하고, 거절할 때는 반드시 이유를 띄운다 —
 * 이유 없이 안 놓이면 사용자는 앱이 고장 났다고 여긴다.
 */

/** 부모가 자식보다 먼저 와야 @xyflow 가 중첩을 그린다. */
function orderParentsFirst(nodes: DesignNode[]): DesignNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depth = (n: DesignNode): number => {
    let d = 0
    let cur = n.parentId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      d++
      cur = byId.get(cur)?.parentId ?? null
    }
    return d
  }
  return [...nodes].sort((a, b) => depth(a) - depth(b))
}

function DiagramInner(): React.JSX.Element {
  const store = useInfraStore()
  const types = useMemo(() => typesOf(store.catalogs), [store.catalogs])
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const flowNodes: Node[] = useMemo(
    () =>
      orderParentsFirst(store.nodes).map((n) => {
        const type = n.typeId ? types[n.typeId] : undefined
        const hasKids = store.nodes.some((k) => k.parentId === n.id)
        const data: InfraNodeData = {
          label: n.name,
          icon: type?.icon ?? 'phosphor:cube',
          color: type?.color,
          isBox: hasKids || Boolean(type?.canContain?.length),
          undocumented: isDocEmpty(n.doc),
          unknownType: Boolean(n.typeId && !type)
        }
        return {
          id: n.id,
          type: 'infra',
          position: { x: n.x, y: n.y },
          width: n.w,
          height: n.h,
          data,
          selected: store.selectedNodeId === n.id,
          ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {})
        }
      }),
    [store.nodes, store.selectedNodeId, types]
  )

  const flowEdges: Edge[] = useMemo(
    () =>
      store.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.label || undefined,
        animated: false
      })),
    [store.edges]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position && !c.dragging) {
          store.moveNode(c.id, Math.round(c.position.x), Math.round(c.position.y))
        }
        if (c.type === 'select' && c.selected) store.select(c.id)
      }
    },
    [store]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) store.addEdge(c.source, c.target)
    },
    [store]
  )

  const palette = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return Object.values(types).filter(
      (t) => !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    )
  }, [types, filter])

  const selected = store.nodes.find((n) => n.id === store.selectedNodeId) ?? null

  const nest = (childId: string, parentId: string | null): void => {
    const r = store.reparentNode(childId, parentId)
    if (!r.ok) setNotice(r.reason ?? '넣을 수 없습니다.')
    else setNotice(null)
  }

  if (!store.activeDesignId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>아직 설계본이 없습니다.</p>
        <Button onClick={() => void store.createDesign('새 아키텍처')} data-infra-create-design>
          새 설계본 만들기
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0" data-infra-view="diagram">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border">
        <div className="p-2">
          <Input
            className="h-8 text-xs"
            placeholder="종류 검색"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          <button
            type="button"
            className="mb-1 flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary"
            onClick={() => store.addNode(null)}
            data-add-type="(none)"
          >
            <InfraIcon icon="phosphor:cube" size={14} />
            맨 노드
          </button>
          {palette.map((t) => (
            <button
              key={t.id}
              type="button"
              data-add-type={t.id}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary"
              onClick={() => store.addNode(t.id)}
              title={t.id}
            >
              <span style={{ color: t.color }}>
                <InfraIcon icon={t.icon} size={14} />
              </span>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onPaneClick={() => store.select(null)}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
          <Panel position="top-right" className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => store.autoLayout()} data-infra-autolayout>
              자동 배치
            </Button>
            <Button
              size="sm"
              onClick={() => void store.save()}
              disabled={!store.dirty}
              data-infra-save
            >
              {store.dirty ? '저장' : '저장됨'}
            </Button>
          </Panel>
          {notice && (
            <Panel position="top-center">
              <div
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
                data-infra-notice
              >
                {notice}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {selected && (
        <aside className="flex w-64 shrink-0 flex-col gap-2 border-l border-border p-3">
          <Input
            className="h-8 text-xs"
            value={selected.name}
            onChange={(e) => store.renameNode(selected.id, e.target.value)}
            data-infra-node-name
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            {selected.typeId ?? '(종류 없음)'}
            {selected.catalogVersion ? ` · 카탈로그 ${selected.catalogVersion}` : ''}
          </p>

          <label className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
            담길 부모
            <select
              className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
              value={selected.parentId ?? ''}
              onChange={(e) => nest(selected.id, e.target.value || null)}
              data-infra-parent
            >
              <option value="">(최상위)</option>
              {store.nodes
                .filter((n) => n.id !== selected.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>

          <div className={cn('mt-2 rounded-md p-2 text-[11px]', isDocEmpty(selected.doc) ? 'bg-sky-50 text-sky-900' : 'bg-secondary')}>
            {isDocEmpty(selected.doc)
              ? '설명이 비어 있습니다 — 노드 문서 뷰에서 채우세요.'
              : selected.doc.role || '설명이 있습니다.'}
          </div>

          <Button
            size="sm"
            variant="destructive"
            className="mt-auto"
            onClick={() => store.removeNode(selected.id)}
            data-infra-node-delete
          >
            노드 삭제(자식 포함)
          </Button>
        </aside>
      )}
    </div>
  )
}

export function DiagramWorkspace(): React.JSX.Element {
  const nodes = useInfraStore((s) => s.nodes)
  // 자식이 옮겨진 뒤 부모 상자가 자식을 계속 감싸도록 크기를 맞춘다.
  useEffect(() => {
    const grown = growParents(nodes)
    const changed = grown.some((g, i) => g.w !== nodes[i].w || g.h !== nodes[i].h)
    if (changed) useInfraStore.setState({ nodes: grown })
  }, [nodes])

  return (
    <ReactFlowProvider>
      <DiagramInner />
    </ReactFlowProvider>
  )
}
