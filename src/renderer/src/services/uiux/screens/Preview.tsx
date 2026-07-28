import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DRAG_THRESHOLD, dropTarget, guideLine, type DropTarget, type NodeRect, type SectionRect } from '../preview/dnd'
import { renderSurface } from '../preview/render'
import { VIEWPORT_WIDTH } from '../preview/tokens'
import type { SurfaceContent, Viewport } from '../types'

/**
 * 미리보기 — 명세 정본 `docs/spec/uiux-ia.md` §6.
 *
 * **그림자 뿌리(Shadow DOM)에 그린다.** 앱은 Tailwind 전역 CSS 위에 서 있어서, 조각의
 * 클래스가 앱 것과 서로를 덮는다. 그림자 안은 그 경계가 막혀 있고 토큰만 CSS 변수로 상속돼
 * 들어간다 — 격리와 테마가 동시에 성립하는 지점.
 *
 * 끌어놓기는 **포인터 이벤트**로 직접 만든다. HTML5 드래그는 그림자 경계에서 대상이 흐려지고
 * 놓을 자리를 픽셀 단위로 정할 수 없다. 포인터 이벤트는 `composed` 라 경계를 그냥 넘어온다.
 */
export interface PreviewProps {
  content: SurfaceContent
  viewport: Viewport
  selectedId?: string | null
  /** 의견이 달린 요소 — 점선으로 표시한다. */
  pinnedIds?: string[]
  /** 요소를 누르면 부른다. 없으면 고르기가 없는 읽기 전용. */
  onSelect?: (id: string | null) => void
  /** 끌어 옮기면 부른다. 없으면 드래그가 아예 시작되지 않는다. */
  onMove?: (id: string, target: DropTarget) => void
}

interface Measured {
  sections: SectionRect[]
  nodes: NodeRect[]
}

const toRect = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * 그림자 안에서 지금 자리를 잰다. **축척(scale)을 나누지 않는다** — 잰 값도 포인터도 똑같이
 * 화면 좌표라 그대로 비교하면 맞는다.
 */
function measure(shadow: ShadowRoot): Measured {
  const sections: SectionRect[] = [...shadow.querySelectorAll('[data-uiux-body]')].map((el) => {
    const style = getComputedStyle(el)
    // 가로로 늘어서는 배치(가로·격자)는 좌우로, 세로로 쌓는 배치는 위아래로 가른다.
    const horizontal = style.display === 'grid' || style.flexDirection === 'row'
    return { id: el.getAttribute('data-uiux-body') ?? '', rect: toRect(el), horizontal }
  })

  const nodes: NodeRect[] = [...shadow.querySelectorAll('[data-uiux-node]')].map((el) => ({
    id: el.getAttribute('data-uiux-node') ?? '',
    sectionId: el.closest('[data-uiux-body]')?.getAttribute('data-uiux-body') ?? '',
    rect: toRect(el)
  }))

  return { sections, nodes }
}

export function Preview({ content, viewport, selectedId, pinnedIds, onSelect, onMove }: PreviewProps) {
  const holderRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<ShadowRoot | null>(null)
  const measuredRef = useRef<Measured | null>(null)
  const pendingRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const targetRef = useRef<DropTarget | null>(null)

  const [scale, setScale] = useState(1)
  const [dragging, setDragging] = useState<string | null>(null)
  const [guide, setGuide] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const width = VIEWPORT_WIDTH[viewport] ?? VIEWPORT_WIDTH.pc

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 그림자 뿌리는 한 번만 만든다 — 두 번 부르면 던진다(개발 모드의 이중 실행 대비).
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: 'open' })
    const { html, css } = renderSurface(content, { selectedId, draggingId: dragging, pinnedIds })
    shadowRef.current.innerHTML = `<style>${css}</style>${html}`
    // pinnedIds 는 배열이라 참조가 매번 바뀔 수 있어 내용으로 비교한다(불필요한 재렌더 방지).
  }, [content, selectedId, dragging, (pinnedIds ?? []).join(',')])

  // 자리 폭에 맞춰 줄인다. 키우지는 않는다(1배가 실제 크기라 그보다 크게 보이면 눈이 속는다).
  useLayoutEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    const fit = (): void => setScale(Math.min(1, (holder.clientWidth - 32) / width))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(holder)
    return () => observer.disconnect()
  }, [width])

  const nodeAt = (event: React.PointerEvent): string | null => {
    for (const el of event.nativeEvent.composedPath()) {
      if (el instanceof Element && el.hasAttribute('data-uiux-node')) {
        return el.getAttribute('data-uiux-node')
      }
    }
    return null
  }

  const finish = useCallback(() => {
    pendingRef.current = null
    targetRef.current = null
    measuredRef.current = null
    setDragging(null)
    setGuide(null)
  }, [])

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!onSelect && !onMove) return
    // 미리보기는 설계를 보는 곳이지 실제로 입력하는 곳이 아니다 — 기본 동작(포커스·글자 선택)을 막는다.
    event.preventDefault()
    const id = nodeAt(event)
    if (!id) {
      onSelect?.(null)
      return
    }
    pendingRef.current = { id, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const pending = pendingRef.current
    if (!pending || !onMove || !shadowRef.current) return

    if (!dragging) {
      const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y)
      if (moved < DRAG_THRESHOLD) return
      // 재는 것은 드래그를 시작할 때 한 번 — 도중에는 배치가 바뀌지 않는다.
      measuredRef.current = measure(shadowRef.current)
      setDragging(pending.id)
    }

    const measured = measuredRef.current
    if (!measured) return
    const point = { x: event.clientX, y: event.clientY }
    const target = dropTarget(point, measured.sections, measured.nodes, pending.id)
    targetRef.current = target
    setGuide(target ? guideLine(target, measured.sections, measured.nodes, pending.id) : null)
  }

  const onPointerUp = (): void => {
    const pending = pendingRef.current
    if (!pending) return
    if (dragging && targetRef.current) onMove?.(pending.id, targetRef.current)
    else if (!dragging) onSelect?.(pending.id)
    finish()
  }

  return (
    <div
      ref={holderRef}
      className="h-full overflow-auto bg-canvas p-4"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={finish}
    >
      <div
        style={{
          width,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // 줄인 만큼 자리도 줄어야 아래쪽에 빈 공간이 남지 않는다.
          marginBottom: scale < 1 ? `-${(1 - scale) * 100}%` : undefined
        }}
        className="border border-line bg-white shadow-sm"
      >
        <div ref={hostRef} />
      </div>

      {/* 놓을 자리 표시 — 화면 좌표를 그대로 쓰므로 축척·스크롤과 무관하게 제자리에 뜬다. */}
      {guide && (
        <div
          data-uiux-guide
          className="pointer-events-none fixed z-50 rounded-full bg-accent"
          style={{ left: guide.left, top: guide.top, width: guide.width, height: guide.height }}
        />
      )}
    </div>
  )
}
