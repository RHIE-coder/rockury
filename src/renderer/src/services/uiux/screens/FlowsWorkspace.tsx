import { AlertTriangle, FolderKanban, Plus, Workflow } from 'lucide-react'
import { useMemo } from 'react'
import { useNav } from '@renderer/nav/useNav'
import { cx } from '@renderer/lib/cx'
import { Button } from '@renderer/ui/button'
import { buildGraph, type FlowEdge, type FlowNode } from '../flows'
import { surfaceKindLabel } from '../catalog'
import { useActiveProject, useSpecStore, useTree } from '../store'

/**
 * Flows — 화면 사이 흐름을 한 장으로. 명세 정본 `docs/spec/uiux-ia.md` Surface `uiux.flows`.
 *
 * 그래프 라이브러리를 들이지 않고 **SVG 로 직접 그린다**: 배치는 순수 계산(`flows.ts`)이고
 * 그리기는 사각형과 선뿐이라, 의존성을 하나 늘리는 값보다 직접 만드는 값이 싸다.
 * (의존성 추가는 `main` 에서 한 명만 할 수 있는 일이기도 하다.)
 */

const NODE_W = 168
const NODE_H = 52
const GAP_X = 96
const GAP_Y = 24
const PAD = 24

export function FlowsWorkspace() {
  const project = useActiveProject()
  const tree = useTree()
  const openDialog = useSpecStore((s) => s.openDialog)
  const selectSurface = useSpecStore((s) => s.selectSurface)
  const selectedSurfaceId = useSpecStore((s) => s.selectedSurfaceId)

  const graph = useMemo(
    () => (project ? buildGraph(tree, project.key) : { nodes: [], edges: [], unreachable: [] }),
    [tree, project?.key]
  )

  if (!project) {
    return (
      <Empty
        title="프로젝트를 고르세요"
        body="흐름은 프로젝트 안 화면들 사이의 것입니다. 위쪽 Project 에서 고르거나 새로 만드세요."
        action={
          <Button size="sm" onClick={() => openDialog({ level: 'project', parentId: null })}>
            <Plus size={14} /> 새 프로젝트
          </Button>
        }
      />
    )
  }

  if (graph.nodes.length === 0) {
    return (
      <Empty
        title="아직 화면이 없어요"
        body="Screens 에서 화면을 만들고 요소에 '누르면 어디로' 를 붙이면 여기 흐름이 그려집니다."
        action={
          <Button size="sm" variant="outline" onClick={() => useNav.getState().selectModule('screens')}>
            Screens 로 가기
          </Button>
        }
      />
    )
  }

  const placed = place(graph.nodes)
  const width = Math.max(...placed.map((p) => p.x + NODE_W)) + PAD
  const height = Math.max(...placed.map((p) => p.y + NODE_H)) + PAD
  const at = new Map(placed.map((p) => [p.address, p]))

  const dangling = graph.edges.filter((e) => e.dangling)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] font-semibold tracking-wide text-muted">흐름</span>
        <span className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 bg-fg/50" /> 화면 이동
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-accent" /> 데이터 변이
          </span>
        </span>
      </div>

      {dangling.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b border-line bg-panel px-3 py-2 text-[12px]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <span className="min-w-0">
            <span className="font-medium">가리키는 화면이 없는 전이</span>
            <span className="text-muted">
              {' — '}
              {dangling.map((e) => e.to).join(' · ')} (오타이거나 지워진 화면이에요)
            </span>
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4" data-uiux-flows>
        <svg width={width} height={height} className="block">
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-fg/50" />
            </marker>
          </defs>

          {graph.edges.map((edge) => {
            const from = at.get(edge.from)
            const to = at.get(edge.to)
            if (!from) return null
            return (
              <EdgeLine key={edge.id} edge={edge} from={from} to={to} />
            )
          })}

          {placed.map((node) => (
            <g
              key={node.address}
              transform={`translate(${node.x},${node.y})`}
              className="cursor-pointer"
              onClick={() => selectSurface(node.surfaceId)}
              data-uiux-flow-node={node.address}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                className={cx(
                  'stroke-line',
                  node.surfaceId === selectedSurfaceId ? 'fill-accent/10 stroke-accent' : 'fill-panel'
                )}
              />
              <text x={10} y={21} className="fill-fg text-[12px] font-medium">
                {clip(node.name, 20)}
              </text>
              <text x={10} y={38} className="fill-muted text-[10px]">
                {node.kind === 'page' ? node.address.split('.').slice(-1)[0] : surfaceKindLabel(node.kind)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

/** 줄·차례 → 좌표. 배치 규칙(간격·크기)은 그리는 쪽 사정이라 순수 계산에서 떼어 여기 둔다. */
function place(nodes: FlowNode[]): (FlowNode & { x: number; y: number })[] {
  return nodes.map((n) => ({
    ...n,
    x: PAD + n.depth * (NODE_W + GAP_X),
    y: PAD + n.order * (NODE_H + GAP_Y)
  }))
}

function EdgeLine({
  edge,
  from,
  to
}: {
  edge: FlowEdge
  from: { x: number; y: number }
  to?: { x: number; y: number }
}) {
  // 데이터 변이는 자기 화면에 머문다 — 화면 이동이 아니므로 짧은 고리로 표시한다.
  if (edge.kind === 'data' || !to) {
    const x = from.x + NODE_W
    const y = from.y + NODE_H / 2
    return (
      <g>
        <path
          d={`M${x},${y} q24,0 24,-18 q0,-14 -18,-14`}
          className={cx('fill-none', edge.dangling ? 'stroke-destructive' : 'stroke-accent')}
          strokeDasharray="4 3"
        />
        <text x={x + 28} y={y - 24} className="fill-muted text-[10px]">
          {clip(edge.label, 22)}
        </text>
      </g>
    )
  }

  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const mid = (x1 + x2) / 2
  return (
    <g>
      <path
        d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
        className="fill-none stroke-fg/40"
        markerEnd="url(#arrow)"
      />
      <text x={mid} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="fill-muted text-[10px]">
        {clip(edge.label, 22)}
      </text>
    </g>
  )
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-strong text-muted">
        {title.includes('프로젝트') ? <FolderKanban size={24} strokeWidth={1.8} /> : <Workflow size={24} strokeWidth={1.8} />}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  )
}
