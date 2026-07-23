import { memo } from 'react'
import type { ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

/**
 * ERD 관계 엣지 — Crow's Foot(까마귀 발) 카디널리티 표기(읽기 전용).
 *  - 참조(PK) 쪽: 항상 "one"(||)
 *  - FK 쪽: isUnique 면 one/zero-or-one, 아니면 many(까마귀 발), nullable 이면 원(0)
 * 자기참조는 루프 경로로 그린다. 색은 Rockury 토큰(muted/accent/accent-2).
 */
export interface RelationErdEdgeData {
  nullable?: boolean
  isUnique?: boolean
  onDelete?: string
  onUpdate?: string
  selfRef?: boolean
  /** 라벨 세로 레인 오프셋(중앙 0 기준, ±). graph.ts 가 겹침 완화용으로 계산. */
  labelOffset?: number
  [key: string]: unknown
}

const ROTATION: Record<Position, number> = {
  [Position.Right]: 0,
  [Position.Left]: 180,
  [Position.Top]: -90,
  [Position.Bottom]: 90
}

function offset(position: Position, d: number): { x: number; y: number } {
  switch (position) {
    case Position.Right:
      return { x: d, y: 0 }
    case Position.Left:
      return { x: -d, y: 0 }
    case Position.Top:
      return { x: 0, y: -d }
    case Position.Bottom:
      return { x: 0, y: d }
  }
}

function Marker({
  x,
  y,
  position,
  color,
  children
}: {
  x: number
  y: number
  position: Position
  color: string
  children: (color: string) => ReactNode
}) {
  return (
    <div
      className="nodrag nopan pointer-events-none"
      style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}
    >
      <svg width="24" height="18" viewBox="-12 -9 24 18" style={{ transform: `rotate(${ROTATION[position]}deg)` }}>
        {children(color)}
      </svg>
    </div>
  )
}

const OneGlyph = (color: string): ReactNode => (
  <line x1="-2" y1="-5" x2="-2" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
)
const ZeroOrOneGlyph = (color: string): ReactNode => (
  <>
    <line x1="-2" y1="-5" x2="-2" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="-7" cy="0" r="3" fill="var(--color-canvas)" stroke={color} strokeWidth="1.5" />
  </>
)
const ManyGlyph =
  (nullable: boolean) =>
  (color: string): ReactNode => (
    <>
      <line x1="4" y1="0" x2="-3" y2="-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="0" x2="-3" y2="0" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="0" x2="-3" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {nullable ? (
        <circle cx="-7" cy="0" r="3" fill="var(--color-canvas)" stroke={color} strokeWidth="1.5" />
      ) : (
        <line x1="-5" y1="-6" x2="-5" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      )}
    </>
  )

/**
 * 자기참조 루프 경로. 루프는 노드 위로 부풀어 올라간다.
 * `top` 은 노드의 실제 상단(loopTop)에서 받아 쓴다 — 핸들 Y(sy/ty)로 계산하면
 * target 핸들이 노드 "정중앙"이라 큰 노드에선 top 이 노드 안쪽에 떨어져 헤더를 덮었다(회귀).
 */
function selfLoopPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  loopTop: number
): { path: string; lx: number; ly: number } {
  const w = 60
  const top = loopTop
  const path = [
    `M ${sx},${sy}`,
    `L ${sx + w * 0.3},${sy}`,
    `Q ${sx + w},${sy} ${sx + w},${top + 20}`,
    `Q ${sx + w},${top} ${sx + w * 0.5},${top}`,
    `L ${tx - w * 0.5},${top}`,
    `Q ${tx - w},${top} ${tx - w},${top + 20}`,
    `Q ${tx - w},${ty} ${tx - w * 0.3},${ty}`,
    `L ${tx},${ty}`
  ].join(' ')
  // 라벨은 루프 정상보다 위에 — 헤더 위 공간에 온전히 얹히도록.
  return { path, lx: (sx + tx) / 2, ly: top - 20 }
}

function RelationErdEdgeComponent({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  data
}: EdgeProps) {
  const d = data as RelationErdEdgeData | undefined
  const nullable = d?.nullable ?? true
  const isUnique = d?.isUnique ?? false
  const onDelete = d?.onDelete
  const onUpdate = d?.onUpdate
  const selfRef = d?.selfRef ?? false
  const hasPolicies = !!onDelete || !!onUpdate
  // 자기참조 루프는 노드 위로 뜬다 → 실제 측정된 노드 상단이 필요(핸들 Y 는 중앙이라 부정확).
  const selfNode = useInternalNode(source)

  const color = selfRef
    ? 'var(--color-accent-2)'
    : selected
      ? 'var(--color-accent)'
      : 'var(--color-muted)'

  let path: string
  let lx: number
  let ly: number
  if (selfRef) {
    // 노드 실제 상단 위 40px 에서 루프를 돌린다. 측정 전이면 핸들 Y 기준으로 폴백.
    const nodeTop = selfNode?.internals.positionAbsolute.y
    const loopTop = (nodeTop ?? Math.min(sourceY, targetY) - 40) - 40
    const loop = selfLoopPath(sourceX, sourceY, targetX, targetY, loopTop)
    path = loop.path
    lx = loop.lx
    ly = loop.ly
  } else {
    ;[path] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 8
    })
    // 라벨은 경로 중점이 아니라 소스(FK 컬럼 행) 옆에 붙인다 — 중점은 긴 경로에서
    // 빈 공간에 떠 보이고(이동 시 특히), 한 지점으로 모이는 라벨끼리 겹친다(회귀).
    // 26px: 소스 마커(카디널리티 글리프, ~+22px)를 지나친 지점.
    const anchor = offset(sourcePosition, 26)
    lx = sourceX + anchor.x
    // 같은 컬럼에서 복수 FK 가 나갈 때만 레인 분산(한 줄 라벨 높이 ≈ 20px).
    ly = sourceY + anchor.y + (d?.labelOffset ?? 0) * 20
  }

  const so = offset(sourcePosition, 10)
  const to = offset(targetPosition, 10)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: selfRef ? undefined : '5 3'
        }}
      />
      <EdgeLabelRenderer>
        {/* FK 쪽 마커 */}
        <Marker x={sourceX + so.x} y={sourceY + so.y} position={sourcePosition} color={color}>
          {isUnique ? (nullable ? ZeroOrOneGlyph : OneGlyph) : ManyGlyph(nullable)}
        </Marker>
        {/* 참조(PK) 쪽 마커 — 항상 one */}
        <Marker x={targetX + to.x} y={targetY + to.y} position={targetPosition} color={color}>
          {OneGlyph}
        </Marker>
        {/* 라벨 + 정책 배지 — 자기참조는 루프 정상 중앙, 일반은 소스 핸들 옆 좌측 정렬. */}
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `${selfRef ? 'translate(-50%, -50%)' : 'translate(0, -50%)'} translate(${lx}px,${ly}px)`,
            pointerEvents: 'none'
          }}
        >
          <div className={cnEdgeLabel(selfRef)}>
            {selfRef ? (
              <>
                <div className="text-center text-[9px] font-bold tracking-wider text-accent-2">SELF</div>
                {label && <div className="text-[10px] text-muted">{label}</div>}
                {hasPolicies && (
                  <div className="flex gap-2 text-[9px]">
                    {onDelete && <span className="text-danger">D:{onDelete}</span>}
                    {onUpdate && <span className="text-info">U:{onUpdate}</span>}
                  </div>
                )}
              </>
            ) : (
              // 한 줄 압축 — 라벨 높이를 컬럼 행 간격(22px) 안에 눌러, 이웃 FK 행 라벨과 안 겹치게.
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                {label && <span className="text-[10px] text-muted">{label}</span>}
                {onDelete && <span className="text-[9px] text-danger">D:{onDelete}</span>}
                {onUpdate && <span className="text-[9px] text-info">U:{onUpdate}</span>}
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function cnEdgeLabel(selfRef: boolean): string {
  return selfRef
    ? 'rounded border border-accent-2/40 bg-accent-2-soft px-1.5 py-0.5 shadow-sm'
    : 'rounded border border-line bg-canvas/95 px-1.5 py-0.5 shadow-sm'
}

export const RelationErdEdge = memo(RelationErdEdgeComponent)
