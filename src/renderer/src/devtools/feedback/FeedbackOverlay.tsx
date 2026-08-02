import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BADGE_RADIUS,
  FEEDBACK_CHANNEL_MISSING,
  badgeCenter,
  badgeHit,
  feedbackFailureMessage,
  feedbackKeyAction,
  markLabel,
  type FeedbackRect
} from '@shared/devFeedback'
import { FEEDBACK_ATTR, targetInBounds } from './inspect'
import { recentLogs } from './consoleTap'
import { useFeedbackLocation } from './navLocation'
import { boundsOfShape, eraserHit, polylinesOf, svgPath } from './draw'
import { SketchPad } from './SketchPad'
import { ToolStrip } from './ToolStrip'
import { BTN, PANEL } from './styles'
import {
  MARK_COLOR,
  MARK_HALO,
  MARK_WIDTH,
  SKETCH_BADGE_COLOR,
  type DraftMark,
  type DrawTool,
  type Point,
  type Shape,
  type Tool
} from './types'

/**
 * 개발용 화면 피드백 오버레이.
 *
 * 쓰는 법: 우측 가장자리 손잡이를 누르거나 ⌘/Ctrl+Shift+F → 문제가 보이는 자리를 콕 누르거나
 * (핀) 끌어서 그리고(표시) 메모 → 보내기. 소스 폴더의 `.harness/feedback/<시각>-<화면>/` 에
 * 그림·메모·요소 정보·콘솔 오류가 떨어지고, 에이전트는 그 폴더만 읽는다.
 *
 * 두 가지가 이 화면 설계를 지배한다:
 *  (1) **자리 다툼** — 도구가 앉은 자리는 피드백을 못 남기는 자리가 된다. 그래서 손잡이는
 *      어느 화면에서도 비어 있는 우측 가장자리 세로 중앙에 두고 끌어 옮길 수 있게 했으며,
 *      도구막대는 가로 전체를 먹지 않는 가운데 알약으로 두고 위아래를 바꿀 수 있게 했다.
 *  (2) **앱의 공용 UI 부품과 디자인 토큰을 일부러 안 쓴다** — 이 도구가 필요한 순간은 화면이나
 *      부품, 토큰이 깨져 있을 때다. 거기에 얹으면 정작 그때 같이 죽는다(styles.ts 참고).
 */

const HANDLE_TOP_KEY = 'rockury.devFeedback.handleTop'
const DOCK_KEY = 'rockury.devFeedback.dock'
// 포인터가 이만큼 움직이면 누르기가 아니라 끌기로 본다. 누르기는 핀, 끌기는 그리기다.
const DRAG_SLOP = 6
// 이보다 작게 그린 자국은 자국이라 보지 않고 핀으로 떨어뜨린다.
const MIN_STROKE = 12

/**
 * 조작을 오버레이 안에서 끊는다 — **열린 모달 위에서 이 도구를 쓰려면 필요하다.**
 *
 * Radix 겹층(모달·팝오버 등 `DismissableLayer`)은 `document` 에 두 개를 걸어 둔다:
 * 바깥에서 포인터를 누르면 닫고(`pointerdown`), 포커스가 바깥으로 나가면 되돌린다
 * (`focusin`). 오버레이는 그 겹층의 자식이 아니므로 우리 조작은 전부 "바깥"으로 취급된다.
 *
 * **오버레이 루트 한 곳에 건다.** 처음엔 그림판(SVG)에만 걸었는데, 정작 동그라미를 친 뒤
 * 메모를 적으려고 입력칸을 누르는 순간 지적하려던 모달이 닫혔다(2026-07-30 사용자 제보).
 * 손잡이·도구막대·목록도 같은 구멍이었다 — 새는 자리를 하나씩 막는 대신, 오버레이 안에서
 * 난 것은 무엇이든 밖으로 안 나가게 루트에서 끊는다. React 핸들러는 이 이벤트가 document
 * 까지 올라가기 전에 돌므로, 겹층은 우리 조작을 아예 못 본다.
 */
function stopAtOverlay(e: React.SyntheticEvent): void {
  e.stopPropagation()
}

/** 이 이벤트가 오버레이 안에서 났나. 창(window) 단계에서 앱 키와 우리 키를 가르는 데 쓴다. */
function fromOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${FEEDBACK_ATTR}]`) !== null
}

/** 포인터 캡처는 부가 기능이다. 실패해도 그리기 자체는 계속돼야 한다. */
function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* 활성 포인터가 아니면 브라우저가 거절한다 */
  }
}

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 막히면 위치 기억만 포기한다 */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 콕 집은 자리의 `bounds` — 배지 지름만 한 정사각형을 그 점에 가운데 맞춘다.
 * 왜 0×0 이 아닌가: `badgeCenter` 도 `targetInBounds` 도 좌상단에서 반지름만큼 안으로 들어간
 * 점을 본다. 0×0 이면 배지가 집은 자리에서 반지름만큼 어긋나고, 요소 탐침도 같이 어긋난다.
 */
function pinBounds(p: Point): FeedbackRect {
  return {
    x: p.x - BADGE_RADIUS,
    y: p.y - BADGE_RADIUS,
    width: BADGE_RADIUS * 2,
    height: BADGE_RADIUS * 2
  }
}

/**
 * 메인이 창을 찍기 전에 화면이 실제로 다시 그려지길 기다린다.
 * 두 프레임을 기다리는 이유: 한 프레임은 "그리라고 예약된" 시점이고, 실제로 화면에
 * 올라온 것은 그다음 프레임이다. 여기서 서두르면 도구막대가 찍힌 그림이 저장된다.
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 20)))
  })
}

/** 메모 입력창을 표시 옆에 붙인다. 아래에 자리가 없으면 위로 올린다. */
function bubblePosition(
  bounds: FeedbackRect,
  dock: 'top' | 'bottom'
): {
  top: number
  left: number
  width: number
} {
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const width = Math.min(292, vw - 16)
  const height = 96
  const below = bounds.y + bounds.height + 10
  // 도구막대가 앉은 쪽으로는 붙이지 않는다.
  const topLimit = dock === 'top' ? TITLEBAR_H + 64 : 8
  const bottomLimit = dock === 'bottom' ? vh - 64 : vh - 8
  const top =
    below + height < bottomLimit
      ? below
      : clamp(bounds.y - height - 10, topLimit, bottomLimit - height)
  return { top, left: clamp(bounds.x, 8, Math.max(8, vw - width - 8)), width }
}

/**
 * 창 끌기 영역에서 우리를 빼낸다 — **이걸 빠뜨리면 도구막대가 아예 안 눌린다.**
 *
 * 타이틀바(`shell/Titlebar.tsx`)가 `-webkit-app-region: drag` 인데, 이 영역은 OS 수준에서
 * 잡혀서 **위에 무엇을 그리든 진짜 마우스 클릭을 창 끌기가 먹는다.** z-index 로는 못 이긴다.
 * 자동 검증(Playwright)은 합성 이벤트를 브라우저 안으로 직접 넣어 이 층을 건너뛰므로
 * **테스트는 통과하는데 사람 손으로는 안 눌리는** 상태가 된다(2026-07-29 실측).
 */
const NO_DRAG: React.CSSProperties = { WebkitAppRegion: 'no-drag' }

/** 타이틀바(h-9 = 36px) 아래로 내리는 여백. 그 위에 얹으면 창 제어와 겹쳐 보이고, 정작
 *  타이틀바 자체를 지적할 수 없다. 창 끌기 문제는 NO_DRAG 가 따로 막는다. */
const TITLEBAR_H = 36

export function FeedbackOverlay(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [marks, setMarks] = useState<DraftMark[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [handleTop, setHandleTop] = useState(50)
  const [dock, setDock] = useState<'top' | 'bottom'>('top')
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(MARK_COLOR)
  const [width, setWidth] = useState<number>(MARK_WIDTH)
  /** 스케치판이 열린 표시. 열려 있는 동안 화면 위 그리기는 통째로 덮인다. */
  const [sketchFor, setSketchFor] = useState<number | null>(null)

  const nextId = useRef(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const sendRef = useRef<() => Promise<void>>(async () => {})
  const location = useFeedbackLocation()

  useEffect(() => {
    setHandleTop(clamp(Number(readStored(HANDLE_TOP_KEY, '50')) || 50, 8, 92))
    setDock(readStored(DOCK_KEY, 'top') === 'bottom' ? 'bottom' : 'top')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setMarks([])
    setDraft(null)
    setEditingId(null)
    setHoverId(null)
    setListOpen(false)
    setSketchFor(null)
  }, [])

  // 화면 얼리기. 그리는 도중 애니메이션이나 스크롤로 화면이 움직이면 표시가 엉뚱한 요소를
  // 가리키게 되고, 캡처 이미지와도 어긋난다.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.setAttribute('data-rockury-frozen', '')
    const style = document.createElement('style')
    style.textContent =
      '[data-rockury-frozen] *, [data-rockury-frozen] *::before, [data-rockury-frozen] *::after' +
      '{animation-play-state:paused!important;transition-property:none!important;}'
    document.head.appendChild(style)
    const stopWheel = (e: WheelEvent): void => e.preventDefault()
    window.addEventListener('wheel', stopWheel, { passive: false })
    return () => {
      root.removeAttribute('data-rockury-frozen')
      style.remove()
      window.removeEventListener('wheel', stopWheel)
    }
  }, [open])

  // 키는 **창(window) 캡처**에서 받는다 — 이 도구가 앱보다 먼저 봐야 하기 때문이다.
  // Radix 겹층은 Escape 를 `document` 캡처에서 듣고 스스로 닫는데, 창 캡처는 그보다 앞선다.
  // 버블로 받던 동안에는 Escape 로 메모창을 접으려는 순간 지적하려던 모달이 같이 닫혔다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = feedbackKeyAction(e, { open, fromOverlay: fromOverlay(e.target) })
      if (action === 'pass') return
      // 여기서 끊는 것이 곧 '화면 얼리기'다 — 열려 있는 동안 앱은 키를 못 본다.
      // 막지 않으면 얼려 놓고 찍는 그림 뒤에서 앱 상태가 조용히 바뀐다.
      e.preventDefault()
      e.stopPropagation()
      if (action === 'toggle') {
        setOpen((v) => !v)
        return
      }
      // 키보드로도 보낼 수 있어야 한다. 창 끌기 영역 같은 창 수준 장치는 마우스만 먹으므로,
      // 버튼이 유일한 길이면 그 한 겹이 막히는 순간 도구 전체가 죽는다(2026-07-29 실측).
      if (action === 'send') {
        void sendRef.current()
        return
      }
      if (action === 'close') {
        // 한 겹씩 닫는다: 스케치판 → 메모창 → 목록 → 오버레이. 실수로 표시를 통째로 날리지 않게.
        if (sketchFor !== null) setSketchFor(null)
        else if (editingId !== null) setEditingId(null)
        else if (listOpen) setListOpen(false)
        else close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, editingId, listOpen, sketchFor, close])

  useEffect(() => {
    // 스케치판이 떠 있으면 그쪽이 주인공이다 — 뒤에 숨은 입력창으로 포커스를 끌어오지 않는다.
    if (editingId !== null && sketchFor === null) inputRef.current?.focus()
  }, [editingId, sketchFor])

  // --- 손잡이: 누르면 열고, 끌면 위치를 옮겨 기억한다 ---
  const dragState = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)

  const onHandleDown = (e: React.PointerEvent): void => {
    capturePointer(e.currentTarget, e.pointerId)
    dragState.current = { startY: e.clientY, startTop: handleTop, moved: false }
  }

  const onHandleMove = (e: React.PointerEvent): void => {
    const drag = dragState.current
    if (!drag) return
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dy) < DRAG_SLOP) return
    drag.moved = true
    setHandleTop(clamp(drag.startTop + (dy / window.innerHeight) * 100, 8, 92))
  }

  const onHandleUp = (): void => {
    const drag = dragState.current
    dragState.current = null
    if (!drag) return
    if (drag.moved) store(HANDLE_TOP_KEY, String(Math.round(handleTop)))
    else setOpen(true)
  }

  /** 표시 하나를 새로 달고 곧바로 메모를 열게 한다 — 핀과 그린 자국이 같은 길로 들어온다. */
  const addMark = (mark: Pick<DraftMark, 'kind' | 'shape' | 'bounds'>): void => {
    const id = nextId.current++
    setMarks((prev) => [
      ...prev,
      { ...mark, id, memo: '', target: targetInBounds(mark.bounds), sketch: null }
    ])
    setEditingId(id)
  }

  // --- 콕 집기 · 그리기 ---
  // 배지도 그림판 위에 있어서, 세 가지를 갈라야 한다: 배지를 "누른 것"(= 메모 다시 열기),
  // 빈 자리를 "누른 것"(= 핀), 그 자리에서 "끈 것"(= 그리기). 가르는 자는 하나다 —
  // 누른 자리에서 DRAG_SLOP 이상 움직였는가. 손잡이도 같은 규칙을 쓴다.
  const downRef = useRef<{ badgeId: number | null; x: number; y: number; moved: boolean } | null>(
    null
  )

  const onDrawDown = (e: React.PointerEvent): void => {
    // 바깥으로 새지 않게 끊는 일은 루트가 한다(stopAtOverlay 주석 참고).
    if (editingId !== null) {
      setEditingId(null)
      return
    }
    // 지우개는 자국을 만들지 않고 이미 그린 것을 집어 지운다. 배지가 먼저다 —
    // 핀은 자국이 없어 배지로만 잡히고, 배지는 자기 자국 위에 겹쳐 앉아 있다.
    if (tool === 'eraser') {
      const hit = badgeHit(marks, e.clientX, e.clientY) ?? eraserHit(marks, e.clientX, e.clientY)
      if (hit !== null) setMarks((prev) => prev.filter((m) => m.id !== hit))
      return
    }
    capturePointer(e.currentTarget, e.pointerId)
    setHoverId(null)
    downRef.current = {
      badgeId: badgeHit(marks, e.clientX, e.clientY),
      x: e.clientX,
      y: e.clientY,
      moved: false
    }
    setDraft({ tool: tool as DrawTool, points: [{ x: e.clientX, y: e.clientY }], color, width })
  }

  const onDrawMove = (e: React.PointerEvent): void => {
    if (!draft) {
      // 안 그리는 동안에는 배지 위 미리보기를 띄운다.
      if (editingId === null) setHoverId(badgeHit(marks, e.clientX, e.clientY))
      return
    }
    // 끌기 판정은 누른 자리에서 얼마나 벗어났는지로 본다. 점 샘플링 간격(2px)으로 재면
    // 살짝 흔들린 클릭이 "끌기"로 잡혀, 배지를 눌렀는데 아무 일도 안 일어난다.
    const down = downRef.current
    if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_SLOP) {
      down.moved = true
    }
    const p = { x: e.clientX, y: e.clientY }
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

  const onDrawUp = (): void => {
    const down = downRef.current
    const shape = draft
    downRef.current = null
    setDraft(null)
    if (!down) return

    if (!down.moved) {
      // 배지를 콕 눌렀으면 새 표시가 아니라 그 메모를 다시 연다.
      if (down.badgeId != null) {
        setEditingId(down.badgeId)
        return
      }
      // 빈 자리를 콕 눌렀다 = "여기". 자국 없이 자리만 집는다.
      // 좁은 것을 가리키려고 그 둘레를 크게 두르면 엉뚱한 상위 감싸개가 잡히던 문제를 없앤다.
      addMark({ kind: 'pin', shape: null, bounds: pinBounds({ x: down.x, y: down.y }) })
      return
    }

    // 움직이긴 했는데 자국이라 하기엔 너무 짧으면 **핀으로 떨어뜨린다.** 버리면 6~12px
    // 사이가 아무 일도 안 일어나는 죽은 구간이 되는데, 그 손짓의 뜻은 어차피 "여기"다.
    const bounds = shape ? boundsOfShape(shape) : null
    if (!shape || !bounds || (bounds.width < MIN_STROKE && bounds.height < MIN_STROKE)) {
      addMark({ kind: 'pin', shape: null, bounds: pinBounds({ x: down.x, y: down.y }) })
      return
    }
    addMark({ kind: 'shape', shape, bounds })
  }

  const send = async (): Promise<void> => {
    if (marks.length === 0 || capturing) return
    // 저장 통로가 없으면 그리기 상태로 들어가기 전에 멈춘다. 개발 서버가 이 도구를 넣기
    // 전부터 떠 있었으면 화면만 갈아끼워지고 메인·preload 는 옛 것이라 통로가 없다 —
    // 그때 그냥 부르면 "아무 반응 없음"으로 보인다(실측).
    if (typeof window.rockury?.devFeedback?.save !== 'function') {
      setToast(FEEDBACK_CHANNEL_MISSING)
      window.setTimeout(() => setToast(null), 6000)
      return
    }
    setEditingId(null)
    setListOpen(false)
    setHoverId(null)
    setSketchFor(null)
    // 도구막대·메모창을 화면에서 걷어낸 뒤 찍는다 — 메인이 창을 그대로 찍으므로,
    // 여기 남아 있는 것은 그림에 그대로 들어간다. 표시(자국·배지)만 남긴다.
    setCapturing(true)
    try {
      await afterPaint()
      const res = await window.rockury.devFeedback.save({
        location,
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight
        },
        marks: marks.map((m) => ({
          kind: m.kind,
          memo: m.memo,
          bounds: m.bounds,
          target: m.target,
          sketch: m.sketch
        })),
        logs: recentLogs()
      })
      setToast(res.hasImage ? res.saved : `${res.saved} (이미지 없이)`)
      close()
    } catch (err) {
      console.error('[dev-feedback]', err)
      // 표시는 그대로 둔다 — 다시 그리게 하지 않고 그대로 다시 보낼 수 있어야 한다.
      setToast(feedbackFailureMessage(err))
    } finally {
      setCapturing(false)
      window.setTimeout(() => setToast(null), 6000)
    }
  }

  // 키보드 경로가 부르는 최신 send. 매 렌더 새로 만들어지는 함수를 키 핸들러 의존성에
  // 걸면 리스너를 계속 다시 매다는 꼴이라, ref 로 최신 것만 가리킨다.
  sendRef.current = send

  const editing = marks.find((m) => m.id === editingId) ?? null
  const bubble = editing ? bubblePosition(editing.bounds, dock) : null
  const sketching = sketchFor !== null ? (marks.find((m) => m.id === sketchFor) ?? null) : null

  /**
   * 저장 결과 안내. **열린 상태와 닫힌 상태 양쪽에서 그린다.**
   * 닫힌 쪽에만 뒀더니, 실패했을 때(오버레이는 열린 채로 남는다) 안내가 나올 자리가 없어
   * "보내기를 눌러도 아무 반응이 없다"로 보였다(실측 — 2026-07-29).
   * 창을 찍는 동안에는 그리지 않는다 — 그림에 안내가 같이 구워진다.
   */
  const toastNode =
    toast && !capturing ? (
      <div
        style={{
          ...PANEL,
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          maxWidth: '70vw',
          borderRadius: 10,
          padding: '8px 12px',
          font: '400 12px/1.5 system-ui, sans-serif',
          pointerEvents: 'none'
        }}
      >
        {toast}
      </div>
    ) : null

  // 메모창이 열려 있으면 미리보기는 접는다 (같은 정보를 두 군데 띄우지 않는다).
  const hovered = editingId === null ? (marks.find((m) => m.id === hoverId) ?? null) : null

  if (!open) {
    return (
      <div
        {...{ [FEEDBACK_ATTR]: '' }}
        // 닫혀 있어도 끊는다 — 모달이 떠 있을 때 손잡이를 누르면, 도구가 열리기도 전에
        // 그 누르기가 "바깥을 눌렀다"로 전달돼 지적하려던 모달이 먼저 사라진다.
        onPointerDown={stopAtOverlay}
        onMouseDown={stopAtOverlay}
        onClick={stopAtOverlay}
        style={{ position: 'fixed', inset: 0, zIndex: 2000, pointerEvents: 'none' }}
      >
        <button
          type="button"
          aria-label="화면 피드백 남기기"
          title="화면 피드백 (⌘/Ctrl+Shift+F)"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          style={{
            position: 'absolute',
            right: 0,
            top: `${handleTop}%`,
            transform: 'translateY(-50%)',
            height: 96,
            width: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            background: 'transparent',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            opacity: 0.35,
            touchAction: 'none',
            pointerEvents: 'auto',
            ...NO_DRAG
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.35')}
        >
          <span style={{ height: 64, width: 6, borderRadius: '4px 0 0 4px', background: MARK_COLOR }} />
        </button>
        {toastNode}
      </div>
    )
  }

  return (
    // 열려 있는 동안에는 창 전체가 no-drag 다 — 그려야 하니 창 끌기가 이겨선 안 된다.
    // (닫힌 상태의 껍데기에는 걸지 않는다. 걸면 타이틀바로 창을 못 끌게 된다.)
    <div
      {...{ [FEEDBACK_ATTR]: '' }}
      // pointerEvents 를 여기서 못박는 이유: Radix 모달(Dialog)이 열려 있으면 그 층이
      // `body` 에 `pointer-events:none` 을 건다. 물려받으면 그림판(SVG)이 포인터를 못 받아
      // **모달 위에서는 자국이 아예 안 그려진다** — 도구막대는 스스로 auto 를 켜 놔서
      // 버튼만 눌리고, "왜 안 그려지지"로 보였다(2026-07-30 사용자 제보).
      // 안 걸린 화면에서는 원래도 auto 라 달라지는 것이 없다.
      // 오버레이 안에서 난 조작은 무엇이든 여기서 끊는다 — 그림판·도구막대·목록·메모창이
      // 전부 이 아래에 있으므로, 새는 자리를 하나씩 막지 않고 한 곳에서 막는다.
      onPointerDown={stopAtOverlay}
      onMouseDown={stopAtOverlay}
      onClick={stopAtOverlay}
      onFocusCapture={stopAtOverlay}
      onBlurCapture={stopAtOverlay}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        touchAction: 'none',
        pointerEvents: 'auto',
        ...NO_DRAG
      }}
    >
      {/* 그림판. 배경을 어둡게 덮지 않는다 — 무엇이 문제인지 눈으로 보면서 그려야 한다. */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          height: '100%',
          width: '100%',
          touchAction: 'none',
          cursor: tool === 'eraser' ? 'pointer' : hoverId !== null ? 'pointer' : 'crosshair'
        }}
        onPointerDown={onDrawDown}
        onPointerMove={onDrawMove}
        onPointerUp={onDrawUp}
        onPointerCancel={onDrawUp}
        onPointerLeave={() => setHoverId(null)}
      >
        {/* 자국 — 스케치판이 굽는 PNG 와 같은 기하(draw.ts)를 읽는다. 각자 그리면 화면에서
            본 것과 저장된 그림이 조용히 어긋난다. */}
        {[...marks.map((m) => m.shape), draft].map((shape, si) =>
          shape
            ? polylinesOf(shape).map((line, li) => (
                <g key={`s-${si}-${li}`}>
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
            : null
        )}
        {marks.map((m, i) => {
          const c = badgeCenter(m.bounds)
          const active = hoverId === m.id || editingId === m.id
          return (
            <g key={`badge-${m.id}`}>
              {/* 눌러서 다시 열 수 있다는 신호. 판정 자체는 badgeHit 가 한다. */}
              {active && !capturing ? (
                <circle cx={c.x} cy={c.y} r={BADGE_RADIUS + 4} fill={MARK_COLOR} opacity={0.25} />
              ) : null}
              {/* 핀은 자국이 없어 배지 하나만 뜬다 — 조준 링을 둘러 "이 한 점"임을 보인다. */}
              {m.kind === 'pin' ? (
                <>
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={BADGE_RADIUS + 5}
                    fill="none"
                    stroke={MARK_HALO}
                    strokeWidth={4}
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={BADGE_RADIUS + 5}
                    fill="none"
                    stroke={MARK_COLOR}
                    strokeWidth={2}
                  />
                </>
              ) : null}
              <circle
                cx={c.x}
                cy={c.y}
                r={BADGE_RADIUS}
                fill={MARK_COLOR}
                stroke={MARK_HALO}
                strokeWidth={2}
              />
              <text
                x={c.x}
                y={c.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={13}
                fill="#ffffff"
              >
                {markLabel(i)}
              </text>
              {/* 그림이 딸린 표시는 배지 어깨에 점 하나 — 목록을 안 열어도 어느 것에 그림이
                  붙었는지 보인다. 저장되는 그림에는 넣지 않는다(도구의 표식이지 지적이 아니다). */}
              {m.sketch && !capturing ? (
                <circle
                  cx={c.x + BADGE_RADIUS - 1}
                  cy={c.y - BADGE_RADIUS + 1}
                  r={4}
                  fill={SKETCH_BADGE_COLOR}
                  stroke={MARK_HALO}
                  strokeWidth={1.5}
                />
              ) : null}
            </g>
          )
        })}
      </svg>

      {toastNode}

      {/* 아래는 전부 "도구" — 창을 찍는 동안에는 그림에 들어가지 않도록 걷어낸다.
          스케치판이 떠 있을 때도 걷는다: 뒤에 가려 안 보이는데 DOM 에 남아 있으면 탭 이동이
          보이지도 않는 버튼으로 새고, 도구 버튼이 두 벌이 되어 어느 쪽이 지금 쓰는 것인지
          알 수 없다. */}
      {capturing || sketching ? null : (
        <>
          {/* 배지 위 미리보기. 눌러서 열지 않고도 무엇을 적었는지 확인만 하고 지나갈 수 있다. */}
          {hovered ? (
            <div
              style={{
                position: 'absolute',
                top: Math.max(4, badgeCenter(hovered.bounds).y - BADGE_RADIUS - 30),
                left: clamp(
                  badgeCenter(hovered.bounds).x - BADGE_RADIUS,
                  8,
                  Math.max(8, document.documentElement.clientWidth - 268)
                ),
                maxWidth: Math.min(260, document.documentElement.clientWidth - 16),
                pointerEvents: 'none',
                borderRadius: 8,
                background: '#0f172a',
                color: '#fff',
                padding: '4px 8px',
                font: '400 11px/1.4 system-ui, sans-serif'
              }}
            >
              {hovered.memo.trim() || '(메모 없음)'}
            </div>
          ) : null}

          {/* 도구막대. 가로 전체를 먹으면 그 띠 전체가 그릴 수 없는 자리가 되므로 가운데
              알약으로만 두고, 좌우 여백은 클릭이 그림판으로 통과하게 비운다. 알약이 덮은
              자리를 지적해야 하면 위아래를 바꾼다. */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              [dock]: dock === 'top' ? TITLEBAR_H : 0,
              display: 'flex',
              flexDirection: dock === 'top' ? 'column' : 'column-reverse',
              alignItems: 'center',
              gap: 6,
              padding: 8,
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                ...PANEL,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                borderRadius: 999,
                padding: 4,
                pointerEvents: 'auto'
              }}
            >
              <span style={{ ...BTN, color: '#94a3b8', cursor: 'default', paddingRight: 6 }}>
                {location.label}
              </span>
              <button
                type="button"
                style={BTN}
                onClick={() => {
                  const next = dock === 'top' ? 'bottom' : 'top'
                  setDock(next)
                  store(DOCK_KEY, next)
                }}
              >
                {dock === 'top' ? '아래로' : '위로'}
              </button>
              <button
                type="button"
                style={{ ...BTN, opacity: marks.length === 0 ? 0.4 : 1 }}
                disabled={marks.length === 0}
                onClick={() => {
                  setListOpen((v) => !v)
                  setEditingId(null)
                }}
              >
                목록
              </button>
              <button
                type="button"
                style={{ ...BTN, opacity: marks.length === 0 ? 0.4 : 1 }}
                disabled={marks.length === 0}
                onClick={() => {
                  setMarks((prev) => prev.slice(0, -1))
                  setEditingId(null)
                }}
              >
                되돌리기
              </button>
              <button type="button" style={BTN} onClick={close}>
                닫기
              </button>
              <button
                type="button"
                disabled={marks.length === 0}
                title="보내기 (⌘/Ctrl+Enter)"
                onClick={() => void send()}
                style={{
                  ...BTN,
                  background: MARK_COLOR,
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontWeight: 600,
                  opacity: marks.length === 0 ? 0.4 : 1
                }}
              >
                보내기{marks.length > 0 ? ` ${marks.length}` : ''}
              </button>
            </div>

            <ToolStrip
              tool={tool}
              onTool={setTool}
              color={color}
              onColor={setColor}
              width={width}
              onWidth={setWidth}
            />

            {/* 표시가 여럿이면 배지를 하나씩 확인하는 것보다 목록이 빠르다. */}
            {listOpen && marks.length > 0 ? (
              <div
                style={{
                  ...PANEL,
                  width: 'min(20rem, calc(100vw - 2rem))',
                  maxHeight: 208,
                  overflowY: 'auto',
                  borderRadius: 12,
                  padding: 4,
                  pointerEvents: 'auto'
                }}
              >
                {marks.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setListOpen(false)
                      setHoverId(null)
                      setEditingId(m.id)
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'flex-start',
                      gap: 8,
                      background: 'transparent',
                      border: 0,
                      borderRadius: 8,
                      padding: '6px 8px',
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ color: MARK_COLOR, font: '600 12px/1.4 system-ui, sans-serif' }}>
                      {markLabel(i)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.4 system-ui, sans-serif' }}>
                      {m.memo.trim() || '(메모 없음)'}
                      {m.sketch ? (
                        <span
                          style={{
                            marginLeft: 4,
                            color: SKETCH_BADGE_COLOR,
                            font: '400 10px/1.6 system-ui, sans-serif'
                          }}
                        >
                          그림 있음
                        </span>
                      ) : null}
                    </span>
                    <span style={{ color: '#94a3b8', font: '400 10px/1.6 system-ui, sans-serif' }}>
                      {m.target?.components[0] ?? m.target?.tag ?? '빈 자리'}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <span
              style={{
                ...PANEL,
                boxShadow: 'none',
                borderRadius: 999,
                padding: '2px 10px',
                color: '#64748b',
                font: '400 11px/1.6 system-ui, sans-serif'
              }}
            >
              {/* 몸짓이 모드를 가르므로, 처음 여는 사람이 배워야 할 것은 이 한 줄이 전부다. */}
              {marks.length === 0 ? '콕 누르면 핀 · 끌면 그리기' : '⌘/Ctrl+Enter 로도 보낼 수 있어요'}
            </span>
          </div>

          {/* 표시마다 붙는 메모 입력창 */}
          {editing && bubble ? (
            <div
              style={{
                ...PANEL,
                position: 'absolute',
                top: bubble.top,
                left: bubble.left,
                width: bubble.width,
                borderRadius: 12,
                padding: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ color: MARK_COLOR, font: '600 12px/1.4 system-ui, sans-serif' }}>
                  {markLabel(marks.findIndex((m) => m.id === editing.id))}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: '#64748b',
                    font: '400 11px/1.4 system-ui, sans-serif'
                  }}
                >
                  {editing.target?.components.join(' ‹ ') || editing.target?.tag || '빈 자리'}
                </span>
              </div>
              <input
                ref={inputRef}
                value={editing.memo}
                placeholder="무엇이 문제인가요?"
                onChange={(e) =>
                  setMarks((prev) =>
                    prev.map((m) => (m.id === editing.id ? { ...m, memo: e.target.value } : m))
                  )
                }
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter 는 "보내기" 라서 여기서 가로채지 않는다 — 창 수준 핸들러로 넘긴다.
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault()
                    setEditingId(null)
                  }
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  borderRadius: 8,
                  border: '1px solid rgba(15,23,42,0.16)',
                  background: '#fff',
                  padding: '6px 8px',
                  font: '400 13px/1.4 system-ui, sans-serif',
                  color: '#0f172a',
                  outline: 'none'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                {/* 말로 안 되는 것은 그림으로 — 메모와 나란히 두는 이유는 둘이 같은 한 가지
                    요청의 두 표현이기 때문이다. */}
                <button
                  type="button"
                  style={editing.sketch ? { ...BTN, color: SKETCH_BADGE_COLOR } : BTN}
                  onClick={() => setSketchFor(editing.id)}
                >
                  {editing.sketch ? '그림 고치기' : '그림 그리기'}
                </button>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  style={BTN}
                  onClick={() => {
                    setMarks((prev) => prev.filter((m) => m.id !== editing.id))
                    setEditingId(null)
                  }}
                >
                  지우기
                </button>
                <button type="button" style={BTN} onClick={() => setEditingId(null)}>
                  확인
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* 스케치판 — 열려 있는 동안 화면 위 그리기를 통째로 덮는다(뒤에 그려지면 안 된다). */}
      {sketching && !capturing ? (
        <SketchPad
          label={markLabel(marks.findIndex((m) => m.id === sketching.id))}
          initial={sketching.sketch}
          onCancel={() => setSketchFor(null)}
          onDone={(dataUrl) => {
            setMarks((prev) =>
              prev.map((m) => (m.id === sketching.id ? { ...m, sketch: dataUrl } : m))
            )
            setSketchFor(null)
          }}
        />
      ) : null}
    </div>
  )
}
