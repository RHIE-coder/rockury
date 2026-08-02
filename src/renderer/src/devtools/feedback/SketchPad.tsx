import { useRef, useState } from 'react'
import { eraserHit, polylinesOf, strokeShapes, svgPath } from './draw'
import { ToolStrip } from './ToolStrip'
import { BTN, PANEL } from './styles'
import {
  MARK_COLOR,
  MARK_HALO,
  MARK_WIDTH,
  SKETCH_BACKGROUND,
  type DrawTool,
  type Point,
  type Shape,
  type Tool
} from './types'

/**
 * 스케치판 — "이렇게 생겼으면 좋겠다"를 그려서 표시에 붙인다.
 *
 * 화면 위 그리기와 역할이 갈린다: 화면 위는 **어디**(실제 화면을 가리킴), 여기는 **어떻게**
 * (아직 없는 모습을 제안함). 그래서 흰 바탕에서 시작한다 — 화면을 깔면 "지금 화면 고치기"가
 * 되어 둘이 같은 일을 하게 된다.
 *
 * 그리는 동안은 SVG 로 살고, 넣을 때 한 번만 캔버스로 굽는다. 캔버스에 직접 그리면
 * 되돌리기 한 번에 전체를 다시 그려야 하고, 화면 위 그리기와 코드가 두 벌이 된다.
 */

// 이만큼 움직여야 자국으로 친다. 스치기만 한 것은 버린다.
const MIN_STROKE = 6
// 저장 배율. 흰 바탕에 선 몇 개라 2배로 떠도 파일이 작고, 글자를 곁들이면 또렷해야 읽힌다.
const EXPORT_SCALE = 2

interface Placed {
  id: number
  shape: Shape
}

export function SketchPad({
  label,
  initial,
  onCancel,
  onDone
}: {
  /** 어느 표시에 붙는 그림인지(①②③…). 여러 장을 그리다 헷갈리지 않게. */
  label: string
  /** 이미 그려 둔 그림이 있으면 그 사실만 알린다 — 다시 열면 새로 그리는 것이 규칙이다. */
  initial: string | null
  onCancel: () => void
  onDone: (dataUrl: string | null) => void
}): React.JSX.Element {
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(MARK_COLOR)
  const [width, setWidth] = useState<number>(MARK_WIDTH)
  const [placed, setPlaced] = useState<Placed[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)

  const boardRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const downAt = useRef<Point | null>(null)

  /** 창 좌표를 판 안쪽 좌표로. 판이 창 한가운데 떠 있어 그대로 쓰면 전부 어긋난다. */
  const local = (e: React.PointerEvent): Point => {
    const box = boardRef.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const onDown = (e: React.PointerEvent): void => {
    const p = local(e)
    if (tool === 'eraser') {
      const hit = eraserHit(placed, p.x, p.y)
      if (hit !== null) setPlaced((prev) => prev.filter((s) => s.id !== hit))
      return
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 활성 포인터가 아니면 거절당한다 — 그리기 자체는 계속돼야 한다 */
    }
    downAt.current = p
    setDraft({ tool: tool as DrawTool, points: [p], color, width })
  }

  const onMove = (e: React.PointerEvent): void => {
    if (!draft) return
    const p = local(e)
    setDraft((prev) => {
      if (!prev) return prev
      // 펜은 지나온 길이 곧 모양이고, 나머지는 시작점과 지금 점 둘로 정해진다.
      if (prev.tool === 'pen') {
        const last = prev.points[prev.points.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return prev
        return { ...prev, points: [...prev.points, p] }
      }
      return { ...prev, points: [prev.points[0], p] }
    })
  }

  const onUp = (): void => {
    const start = downAt.current
    const shape = draft
    downAt.current = null
    setDraft(null)
    if (!shape || !start) return
    const end = shape.points[shape.points.length - 1]
    if (shape.tool !== 'pen' && Math.hypot(end.x - start.x, end.y - start.y) < MIN_STROKE) return
    if (polylinesOf(shape).length === 0) return
    setPlaced((prev) => [...prev, { id: nextId.current++, shape }])
  }

  /** 그린 것을 PNG 로 굽는다. 아무것도 안 그렸으면 null — 빈 흰 판을 파일로 남기지 않는다. */
  const bake = (): string | null => {
    const box = boardRef.current?.getBoundingClientRect()
    if (!box || placed.length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(box.width * EXPORT_SCALE)
    canvas.height = Math.round(box.height * EXPORT_SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = SKETCH_BACKGROUND
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    strokeShapes(
      ctx,
      placed.map((p) => p.shape),
      EXPORT_SCALE
    )
    return canvas.toDataURL('image/png')
  }

  const shapes = [...placed.map((p) => p.shape), ...(draft ? [draft] : [])]
  const empty = placed.length === 0

  return (
    // 화면 위 그리기를 통째로 덮는다 — 스케치판이 떠 있는 동안 뒤에 그려지면 안 된다.
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: 'rgba(15,23,42,0.45)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            ...PANEL,
            borderRadius: 999,
            padding: '4px 10px',
            color: MARK_COLOR,
            font: '600 12px/1.4 system-ui, sans-serif'
          }}
        >
          {label}
        </span>
        <span
          style={{
            ...PANEL,
            boxShadow: 'none',
            borderRadius: 999,
            padding: '4px 10px',
            color: '#64748b',
            font: '400 11px/1.6 system-ui, sans-serif'
          }}
        >
          어떻게 생겼으면 좋겠는지 그려 주세요
        </span>
      </div>

      <div
        ref={boardRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          borderRadius: 12,
          background: SKETCH_BACKGROUND,
          boxShadow: '0 16px 40px rgba(15,23,42,0.35)',
          touchAction: 'none',
          cursor: tool === 'eraser' ? 'pointer' : 'crosshair'
        }}
      >
        <svg style={{ position: 'absolute', inset: 0, height: '100%', width: '100%' }}>
          {shapes.map((shape, i) =>
            polylinesOf(shape).map((line, j) => (
              <g key={`${i}-${j}`}>
                {/* 흰 테두리를 먼저 깔아 어두운 색 위에서도 자국이 읽힌다 — 저장 PNG 와 같은 규칙. */}
                <path
                  d={svgPath(line)}
                  fill="none"
                  stroke={MARK_HALO}
                  strokeWidth={shape.width + 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={svgPath(line)}
                  fill="none"
                  stroke={shape.color}
                  strokeWidth={shape.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))
          )}
        </svg>
        {empty && !draft ? (
          <p
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              margin: 0,
              color: '#94a3b8',
              font: '400 12px/1.6 system-ui, sans-serif',
              pointerEvents: 'none'
            }}
          >
            {initial ? '다시 그리면 앞서 그린 그림을 대신합니다' : '여기에 그리세요'}
          </p>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <ToolStrip
          tool={tool}
          onTool={setTool}
          color={color}
          onColor={setColor}
          width={width}
          onWidth={setWidth}
        />
        <div
          style={{
            ...PANEL,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            borderRadius: 999,
            padding: 4
          }}
        >
          <button
            type="button"
            style={{ ...BTN, opacity: empty ? 0.4 : 1 }}
            disabled={empty}
            onClick={() => setPlaced((prev) => prev.slice(0, -1))}
          >
            되돌리기
          </button>
          <button
            type="button"
            style={{ ...BTN, opacity: empty ? 0.4 : 1 }}
            disabled={empty}
            onClick={() => setPlaced([])}
          >
            전부 지우기
          </button>
          {/* 이미 붙은 그림을 떼는 길 — 다시 열어 놓고 안 그리면 그대로 두는 게 기본이라 따로 둔다. */}
          {initial ? (
            <button type="button" style={BTN} onClick={() => onDone(null)}>
              그림 떼기
            </button>
          ) : null}
          <button type="button" style={BTN} onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            disabled={empty}
            onClick={() => onDone(bake())}
            style={{
              ...BTN,
              background: MARK_COLOR,
              color: '#fff',
              borderRadius: 999,
              padding: '6px 12px',
              fontWeight: 600,
              opacity: empty ? 0.4 : 1
            }}
          >
            넣기
          </button>
        </div>
      </div>
    </div>
  )
}
