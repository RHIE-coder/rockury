import { memo } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { GROUP_MIN_H, GROUP_MIN_W, type GroupColorKey } from './group'

/**
 * 그룹(레이어) 배경 노드 — 이름표를 단 색 영역. 정본: §db-console.diagram.group.
 *
 * 두 가지가 의도된 설계다.
 * ⑴ **영역 안쪽은 클릭을 통과시킨다**(`pointer-events: none`). 큰 그룹이 화면을 덮으면
 *    캔버스를 끌어 옮길 수도, 빈 곳을 눌러 선택을 풀 수도 없게 된다. 대신 **이름표를 끌어** 옮긴다.
 * ⑵ 노드 zIndex 를 -1 로 둬 테이블·관계선보다 **뒤에** 깔린다(AC-1).
 */

export interface GroupErdNodeData {
  name: string
  colorKey: GroupColorKey
  /** 소속 테이블 수 — 접었을 때 몇 개가 숨었는지 알린다. */
  count: number
  collapsed: boolean
  onToggleCollapse: () => void
  /** 크기를 손으로 조절할 수 있는가(배치를 바꿀 수 있을 때만). */
  resizable: boolean
  /** 손으로 조절한 결과 — 자리와 크기를 함께 넘긴다(모서리를 잡으면 자리도 움직인다). */
  onResize: (r: { x: number; y: number; width: number; height: number }) => void
  /** 손으로 정한 크기를 쓰는 중인가 — 조절 손잡이를 좀 더 뚜렷하게 보인다. */
  sized: boolean
  [key: string]: unknown
}

/**
 * 그룹 색 — 앱 팔레트(탁한 청록·테라코타·세이지)와 어울리도록 **채도를 낮춘 옅은 색**만 쓴다.
 * 화이트 테마 고정이므로 채움 위에 놓인 테이블 카드(흰 배경)가 그대로 읽혀야 한다.
 */
export const GROUP_COLORS: Record<GroupColorKey, { border: string; fill: string; bar: string; text: string }> = {
  sky: { border: '#b8cde3', fill: '#eef4fa', bar: '#dbe8f4', text: '#2f5a86' },
  violet: { border: '#c9c1de', fill: '#f3f1f9', bar: '#e6e1f2', text: '#55488a' },
  amber: { border: '#e0c9a3', fill: '#faf5ec', bar: '#f2e6d2', text: '#8a6220' },
  emerald: { border: '#aecec1', fill: '#eef6f3', bar: '#dcece6', text: '#2f7360' },
  rose: { border: '#e0b8b5', fill: '#faf0ef', bar: '#f2dcda', text: '#8f453f' },
  slate: { border: '#cbd1d8', fill: '#f4f6f8', bar: '#e6eaee', text: '#4b5763' }
}

/** 이름표(드래그 손잡이)에 붙는 클래스 — ErdCanvas 가 `dragHandle` 로 지목한다. */
export const GROUP_DRAG_HANDLE = 'erd-group-handle'

function GroupErdNodeComponent({ data, width, height }: NodeProps) {
  const { name, colorKey, count, collapsed, onToggleCollapse, resizable, onResize, sized } =
    data as unknown as GroupErdNodeData
  const c = GROUP_COLORS[colorKey] ?? GROUP_COLORS.slate

  return (
    <div
      data-erd-group={name || '(이름 없음)'}
      data-erd-group-collapsed={collapsed ? 'true' : undefined}
      style={{ width, height, borderColor: c.border, background: c.fill }}
      // 안쪽은 캔버스로 통과 — 이름표만 pointer-events 를 되살린다.
      className="pointer-events-none rounded-xl border-2 border-dashed"
    >
      {/* 크기 손조절 — 상자 본체는 클릭을 통과시키므로 손잡이만 pointer-events 를 되살린다.
          접힌 상자는 이름표 한 장 크기가 고정이라 조절 대상이 아니다. */}
      {resizable && !collapsed && (
        <NodeResizer
          minWidth={GROUP_MIN_W}
          minHeight={GROUP_MIN_H}
          isVisible
          // ⚠ 변(line)은 클릭을 **먹지 않게** 둔다. 투명한 변이 pointer-events 를 잡으면
          //   상자 가장자리에 걸친 테이블을 누를 수 없다(실측: 편집 진입 후 노드 클릭 실패).
          //   크기 조절은 **모서리 손잡이**로만 한다.
          lineClassName="!pointer-events-none !border-transparent"
          handleClassName={`!pointer-events-auto !size-1.5 !rounded-sm !border-none ${sized ? '!opacity-70' : '!opacity-30'} hover:!opacity-100`}
          handleStyle={{ background: c.text }}
          onResize={(_, p) => onResize({ x: p.x, y: p.y, width: p.width, height: p.height })}
        />
      )}

      {/* 접힌 그룹을 드나드는 관계선의 끝점(rewireCollapsedEdges) — 평소엔 안 보인다. */}
      <Handle type="target" position={Position.Left} className="!border-none !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!border-none !bg-transparent" />

      <div
        style={{ background: c.bar, color: c.text }}
        className={`${GROUP_DRAG_HANDLE} pointer-events-auto flex w-fit max-w-full cursor-grab items-center gap-1.5 rounded-t-[9px] rounded-br-lg px-2 py-1 text-[12px] font-semibold active:cursor-grabbing`}
      >
        <button
          type="button"
          data-erd-group-toggle={name || '(이름 없음)'}
          title={collapsed ? '그룹 펴기' : '그룹 접기'}
          // 이름표가 드래그 손잡이라, 접기 버튼의 mousedown 이 드래그로 새지 않게 막는다.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onToggleCollapse}
          className="nodrag -ml-0.5 rounded p-0.5 hover:bg-black/10"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <Layers className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate" title={name}>
          {name || '이름 없는 그룹'}
        </span>
        <span className="shrink-0 rounded bg-black/10 px-1 text-[10px] font-bold tabular-nums">{count}</span>
        {collapsed && <span className="shrink-0 text-[10px] font-medium opacity-70">접힘</span>}
      </div>
    </div>
  )
}

export const GroupErdNode = memo(GroupErdNodeComponent)
