import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BADGE_RADIUS,
  FEEDBACK_CHANNEL_MISSING,
  MAX_STEPS,
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
import { boundsOfShape, partHit, polylinesOf, svgPath } from './draw'
import {
  appendPart,
  isLastPart,
  mergeMarks,
  moveStep,
  partsOnScreen,
  removeMark,
  removePart,
  removePartsOnScreen,
  removeStep,
  screenSpan,
  setMemo,
  splitMark
} from './group'
import { feedbackHint } from './hint'
import { reviewScreens } from './review'
import { ReviewModal } from './ReviewModal'
import { SketchPad } from './SketchPad'
import { ToolStrip } from './ToolStrip'
import { BTN, PANEL, SCROLL_ATTR } from './styles'
import {
  MARK_COLOR,
  MARK_HALO,
  MARK_WIDTH,
  SKETCH_BADGE_COLOR,
  type DraftMark,
  type DraftStep,
  type DrawTool,
  type MarkPart,
  type Point,
  type Shape,
  type Tool
} from './types'

/**
 * 개발용 화면 피드백 오버레이.
 *
 * 쓰는 법: 우측 가장자리 손잡이를 누르거나 ⌘/Ctrl+Shift+F → 문제가 보이는 자리를 콕 누르거나
 * (핀) 끌어서 그리고(표시) 메모 → 화면을 옮겨야 하면 "다음 화면" → 보내기. 소스 폴더의
 * `.harness/feedback/<시각>-<화면>/` 에 그림·메모·요소 정보·콘솔 오류가 떨어지고,
 * 에이전트는 그 폴더만 읽는다.
 *
 * 담는 그릇이 셋으로 겹쳐 있다: **흐름**(화면 여럿) ⊃ **묶음**(메모 하나) ⊃ **표시**(자국 하나).
 * 묶음과 화면은 서로 가로지른다 — 메모 하나가 화면 여럿을 걸칠 수 있다.
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
/**
 * 쌓는 중인 피드백을 화면 다시 그리기 너머로 잇는 자리.
 *
 * 화면을 여럿 도는 동안 개발 서버는 코드를 저장할 때마다 렌더러를 다시 그린다. 화면
 * 그림은 이미 메인이 초안 폴더에 써 뒀으므로 여기엔 **좌표·메모·제안 그림만** 담긴다.
 * sessionStorage 인 이유: 창을 닫으면 같이 사라져야 한다(다음에 열었을 때 남의 이야기가
 * 붙어 있으면 안 된다).
 */
const RESUME_KEY = 'rockury.devFeedback.resume'
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
  /** 메모창이 열려 있는 묶음. 열려 있는 동안 새로 그린 자국은 **이 묶음에 붙는다** —
   *  그게 "여러 자국을 한 맥락으로 묶는다"의 전부다(모드 전환 버튼을 두지 않는 이유). */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [hover, setHover] = useState<{ id: number; part: number } | null>(null)
  /** 나중에 묶기 — 훑어보기에서 고르는 중인 묶음들. null 이면 고르는 중이 아니다. */
  const [mergeIds, setMergeIds] = useState<number[] | null>(null)
  /** 묶기처럼 조용히 잃는 것이 있는 동작을 알리는 한 줄(도구막대 아래 안내 자리). */
  const [notice, setNotice] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [handleTop, setHandleTop] = useState(50)
  const [dock, setDock] = useState<'top' | 'bottom'>('top')
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(MARK_COLOR)
  const [width, setWidth] = useState<number>(MARK_WIDTH)
  /** 스케치판이 열린 묶음. 열려 있는 동안 화면 위 그리기는 통째로 덮인다. */
  const [sketchFor, setSketchFor] = useState<number | null>(null)
  /** 이미 굳힌 화면들. 배열 차례가 곧 흐름 차례다. */
  const [steps, setSteps] = useState<DraftStep[]>([])
  /** 메인에 쌓는 중인 초안 폴더 이름. 화면을 처음 굳힐 때 메인이 지어 준다. */
  const [draftFolder, setDraftFolder] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  /**
   * 굳힌 화면의 썸네일 — 화면 신원(`seq`) → 데이터 URL(못 읽었으면 null).
   * 그림 자체는 초안 폴더에 있고 여기엔 **볼 때 읽어 온 것만** 든다(이어받기에 안 실린다).
   */
  const [shots, setShots] = useState<Record<number, string | null>>({})

  const nextId = useRef(1)
  /** 지금 읽어 오는 중인 화면들. 훑어보기를 여닫을 때 같은 그림을 두 번 읽지 않게 한다. */
  const loadingShots = useRef(new Set<number>())
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useFeedbackLocation()

  /**
   * 지금 그리고 있는 화면의 신원. 굳힌 화면 중 가장 큰 번호 다음이다.
   * 배열 길이로 세지 않는 이유: 화면을 빼면 길이가 줄어드는데, 그 번호를 다시 쓰면
   * 살아 있는 표시가 새 화면에 달라붙는다.
   */
  const screen = steps.reduce((max, s) => Math.max(max, s.seq), 0) + 1

  useEffect(() => {
    setHandleTop(clamp(Number(readStored(HANDLE_TOP_KEY, '50')) || 50, 8, 92))
    setDock(readStored(DOCK_KEY, 'top') === 'bottom' ? 'bottom' : 'top')
    // 쌓다 만 것이 있으면 이어 받는다 — 화면을 한 번 다시 그렸다고 여러 화면 분량이
    // 통째로 날아가면 이 기능은 두 번 다시 안 쓰이게 된다.
    try {
      const saved = window.sessionStorage.getItem(RESUME_KEY)
      if (!saved) return
      const state = JSON.parse(saved) as {
        draftFolder: string
        steps: DraftStep[]
        marks: DraftMark[]
      }
      if (!Array.isArray(state.steps) || state.steps.length === 0) return
      setDraftFolder(state.draftFolder)
      setSteps(state.steps)
      setMarks(state.marks ?? [])
      nextId.current = Math.max(0, ...(state.marks ?? []).map((m) => m.id)) + 1
    } catch {
      /* 못 읽으면 새로 시작한다 — 이어받기는 덤이지 전제가 아니다 */
    }
  }, [])

  // 쌓는 중인 것을 적어 둔다. 화면 그림은 이미 메인이 들고 있어 여기엔 좌표·메모만 담긴다.
  useEffect(() => {
    try {
      if (draftFolder === null) window.sessionStorage.removeItem(RESUME_KEY)
      else window.sessionStorage.setItem(RESUME_KEY, JSON.stringify({ draftFolder, steps, marks }))
    } catch {
      /* 용량이 찼거나 막혔으면 이어받기만 포기한다 (지금 그린 것은 그대로 산다) */
    }
  }, [draftFolder, steps, marks])

  /** 화면에 띄운 것만 접는다 — 쌓아 둔 흐름은 그대로 살아 있다. */
  const collapse = useCallback(() => {
    setOpen(false)
    setDraft(null)
    setEditingId(null)
    setHover(null)
    setMergeIds(null)
    setSketchFor(null)
    setReviewOpen(false)
  }, [])

  /** 다 버린다. 메인에 쌓아 둔 초안도 같이 지운다. */
  const close = useCallback(() => {
    collapse()
    setMarks([])
    setSteps([])
    setNotice(null)
    // 썸네일도 같이 버린다 — 다음 제보는 화면 번호가 1부터 다시 시작하므로, 남겨 두면
    // 남의 이야기 그림이 새 목록에 깔린다.
    setShots({})
    if (draftFolder) void window.rockury?.devFeedback?.discard?.(draftFolder).catch(() => {})
    setDraftFolder(null)
  }, [collapse, draftFolder])

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
    // 우리 목록 안에서 난 휠은 그 목록이 쓴다(SCROLL_ATTR). 나머지는 삼킨다 — 뒤 화면이
    // 움직이면 표시가 엉뚱한 요소를 가리키고 캡처 이미지와도 어긋난다.
    const stopWheel = (e: WheelEvent): void => {
      if (e.target instanceof Element && e.target.closest(`[${SCROLL_ATTR}]`)) return
      e.preventDefault()
    }
    window.addEventListener('wheel', stopWheel, { passive: false })
    return () => {
      root.removeAttribute('data-rockury-frozen')
      style.remove()
      window.removeEventListener('wheel', stopWheel)
    }
  }, [open])

  // 키 핸들러가 최신 상태를 보게 하는 창구. 그리는 동안 바뀌는 값(marks·screen)과 매 렌더
  // 새로 만들어지는 함수(send·nextScreen)를 의존성에 넣으면 리스너를 계속 다시 매단다.
  const liveRef = useRef({
    marks,
    screen,
    send: async (): Promise<void> => {},
    nextScreen: async (): Promise<void> => {}
  })

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
        void liveRef.current.send()
        return
      }
      if (action === 'close') {
        // 한 겹씩 닫는다: 스케치판 → 고르기 → 훑어보기 → 메모창 → 오버레이.
        // 고르기가 훑어보기보다 앞인 이유: 고르는 중에 Esc 를 누르면 뜻은 "고르기를
        // 그만두겠다"이지, 애써 열어 둔 목록까지 닫으라는 것이 아니다.
        if (sketchFor !== null) setSketchFor(null)
        else if (mergeIds !== null) setMergeIds(null)
        else if (reviewOpen) setReviewOpen(false)
        else if (editingId !== null) setEditingId(null)
        // 맨 바깥의 Escape 는 **접기**다(버리기가 아니다). 화면 여럿을 돌며 쌓은 것을 키
        // 한 번에 잃으면 안 된다. 지금 화면에 그린 것이 있으면 굳히고 접는다 — 안 굳히면
        // 그 표시가 어느 화면 것인지 잃고, 다음에 열었을 때 남의 화면 위에 떠 있게 된다.
        else if (
          liveRef.current.marks.some((m) =>
            m.parts.some((p) => p.screen === liveRef.current.screen)
          )
        ) {
          void liveRef.current.nextScreen()
        } else collapse()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, editingId, mergeIds, sketchFor, reviewOpen, collapse])

  useEffect(() => {
    // 스케치판이 떠 있으면 그쪽이 주인공이다 — 뒤에 숨은 입력창으로 포커스를 끌어오지 않는다.
    if (editingId !== null && sketchFor === null) inputRef.current?.focus()
  }, [editingId, sketchFor])

  /**
   * 훑어보기를 열 때 굳힌 화면의 그림을 읽어 온다 — 볼 때만 읽는다.
   * 미리 들고 있지 않는 이유: 개발 중엔 화면이 수시로 다시 그려져 메모리에 든 것은 어차피
   * 날아가고, 이어받기(sessionStorage)에 실으면 화면 몇 장에 용량이 찬다.
   */
  useEffect(() => {
    if (!reviewOpen || !draftFolder) return
    const read = window.rockury?.devFeedback?.shot
    if (typeof read !== 'function') return
    for (const step of steps) {
      if (!step.hasImage || step.seq in shots || loadingShots.current.has(step.seq)) continue
      const seq = step.seq
      loadingShots.current.add(seq)
      void read({ draft: draftFolder, seq })
        .then((url) => setShots((prev) => ({ ...prev, [seq]: url })))
        // 그림을 못 읽어도 목록은 그대로 선다 — 목록의 본체는 메모와 요소다.
        .catch(() => setShots((prev) => ({ ...prev, [seq]: null })))
        .finally(() => loadingShots.current.delete(seq))
    }
  }, [reviewOpen, draftFolder, steps, shots])

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

  /** 알림 한 줄. 실패해도 오버레이는 열린 채 남으므로 이 자리에 띄워야 눈에 들어온다. */
  const say = (message: string, ms = 4000): void => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), ms)
  }

  /**
   * 새 자국 하나를 받는다. **메모창이 열려 있으면 그 묶음에 붙이고, 아니면 새 묶음을 세운다.**
   * 모드 전환 버튼 없이 "여럿을 한 맥락으로" 묶는 길이 이것 하나다 — 떠 있는 메모창 자체가
   * "지금 이 묶음이 듣고 있다"는 표시다.
   */
  const addPart = (part: MarkPart): void => {
    if (editingId !== null) {
      setMarks((prev) => appendPart(prev, editingId, part))
      return
    }
    const id = nextId.current++
    setMarks((prev) => [...prev, { id, parts: [part], memo: '', sketch: null }])
    setEditingId(id)
  }

  /** 콕 집은 자리 하나를 표시로 만든다. 요소는 자리마다 따로 캔다. */
  const pinPart = (p: Point): MarkPart => {
    const bounds = pinBounds(p)
    return { kind: 'pin', shape: null, bounds, target: targetInBounds(bounds), screen }
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
    if (tool === 'eraser') {
      // 지우개는 자국을 만들지 않고 이미 그린 것을 집어 지운다. 묶음째가 아니라 **자국
      // 하나**만 지운다 — 삐뚤어진 상자 하나 때문에 애써 적은 메모까지 날아가면 안 된다.
      // 지금 화면의 자국만 집는다(지난 화면 것은 눈에 안 보인다).
      const hit = partHit(marks, e.clientX, e.clientY, screen)
      if (!hit) return
      // 마지막 자국이면 묶음도 같이 사라진다. 열려 있던 메모창은 없는 것을 가리키지 않게 닫는다.
      if (isLastPart(marks, hit.id) && editingId === hit.id) setEditingId(null)
      setMarks((prev) => removePart(prev, hit.id, hit.part))
      return
    }
    capturePointer(e.currentTarget, e.pointerId)
    setHover(null)
    downRef.current = {
      badgeId: badgeHit(marks, e.clientX, e.clientY, screen)?.id ?? null,
      x: e.clientX,
      y: e.clientY,
      moved: false
    }
    setDraft({ tool: tool as DrawTool, points: [{ x: e.clientX, y: e.clientY }], color, width })
  }

  const onDrawMove = (e: React.PointerEvent): void => {
    if (!draft) {
      // 안 그리는 동안에는 배지 위 미리보기를 띄운다.
      if (editingId === null) setHover(badgeHit(marks, e.clientX, e.clientY, screen))
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
      // 배지를 콕 눌렀으면 새 표시가 아니라 그 메모를 다시 연다. 배지는 묶음의 손잡이라,
      // 묶음 안 어느 표시를 눌러도 같은 메모가 열린다.
      if (down.badgeId != null) {
        setEditingId(down.badgeId)
        return
      }
      // 빈 자리를 콕 눌렀다 = "여기". 자국 없이 자리만 집는다.
      // 좁은 것을 가리키려고 그 둘레를 크게 두르면 엉뚱한 상위 감싸개가 잡히던 문제를 없앤다.
      addPart(pinPart({ x: down.x, y: down.y }))
      return
    }

    // 움직이긴 했는데 자국이라 하기엔 너무 짧으면 **핀으로 떨어뜨린다.** 버리면 6~12px
    // 사이가 아무 일도 안 일어나는 죽은 구간이 되는데, 그 손짓의 뜻은 어차피 "여기"다.
    const bounds = shape ? boundsOfShape(shape) : null
    if (!shape || !bounds || (bounds.width < MIN_STROKE && bounds.height < MIN_STROKE)) {
      addPart(pinPart({ x: down.x, y: down.y }))
      return
    }
    addPart({ kind: 'shape', shape, bounds, target: targetInBounds(bounds), screen })
  }

  /**
   * 되돌리기 — 자국 **하나**만 걷는다. 열려 있는 묶음이 있으면 거기서, 없으면 지금 화면에
   * 마지막으로 그린 묶음에서. 묶음째 걷으면 방금 적은 메모까지 같이 날아간다.
   */
  const undoLastPart = (): void => {
    const onHere = marks.filter((m) => m.parts.some((p) => p.screen === screen))
    const targetId = editingId ?? onHere[onHere.length - 1]?.id
    if (targetId == null) return
    const target = marks.find((m) => m.id === targetId)
    if (!target) return
    // 지금 화면의 마지막 자국을 집는다 — 지난 화면 것을 걷으면 이미 뜬 그림과 어긋난다.
    const at = target.parts.map((p) => p.screen).lastIndexOf(screen)
    if (at < 0) return
    if (isLastPart(marks, targetId)) setEditingId(null)
    setMarks((prev) => removePart(prev, targetId, at))
  }

  /** 목록에서 고른 묶음들을 하나로 합친다. 그림은 묶음당 한 장이라 맨 앞 것만 남는다. */
  const applyMerge = (): void => {
    if (!mergeIds || mergeIds.length < 2) return
    const result = mergeMarks(marks, mergeIds)
    setMarks(result.marks)
    setMergeIds(null)
    setEditingId(null)
    say(
      result.droppedSketches > 0
        ? '묶었습니다 · 제안 그림은 맨 앞 것만 남았습니다'
        : '묶었습니다 · 메모 하나를 같이 씁니다'
    )
  }

  /** 저장 통로가 붙어 있나. 개발 서버가 이 도구를 넣기 전부터 떠 있었으면 화면만
   *  갈아끼워지고 메인·preload 는 옛 것이라 통로가 없다 — 그때 그냥 부르면 "아무 반응
   *  없음"으로 보인다(실측). 그리기 상태로 들어가기 전에 멈춘다. */
  const channelReady = (): boolean => {
    if (typeof window.rockury?.devFeedback?.step === 'function') return true
    setToast(FEEDBACK_CHANNEL_MISSING)
    window.setTimeout(() => setToast(null), 6000)
    return false
  }

  /**
   * 지금 화면을 흐름의 한 차례로 굳힌다 — 메인이 창을 찍어 초안 폴더에 쓰고 목록에 더한다.
   *
   * **화면을 떠나기 전에 굳히는 것이 이 기능의 전부다.** 예전처럼 보낼 때 한 번만 뜨면,
   * 그 사이 화면을 옮긴 순간 앞 화면의 좌표가 지금 화면의 엉뚱한 자리를 가리키게 된다.
   */
  const freezeScreen = async (): Promise<{ folder: string; step: DraftStep } | null> => {
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight
    }
    // 도구막대·메모창을 화면에서 걷어낸 뒤 찍는다 — 메인이 창을 그대로 찍으므로,
    // 여기 남아 있는 것은 그림에 그대로 들어간다. 표시(자국·배지)만 남긴다.
    setCapturing(true)
    try {
      await afterPaint()
      const res = await window.rockury.devFeedback.step({
        draft: draftFolder,
        seq: screen,
        location
      })
      const step: DraftStep = { seq: screen, location, viewport, hasImage: res.hasImage }
      setDraftFolder(res.draft)
      setSteps((prev) => [...prev, step])
      // 굳힌 것을 곧바로 쓰는 쪽(보내기)이 있어 값을 돌려준다 — 상태 갱신을 기다릴 수 없다.
      return { folder: res.draft, step }
    } catch (err) {
      console.error('[dev-feedback]', err)
      say(`화면을 저장하지 못했습니다 · ${feedbackFailureMessage(err)}`, 6000)
      return null
    } finally {
      setCapturing(false)
    }
  }

  /** 지금 화면을 굳히고 오버레이를 접는다. 앱을 쓰다 손잡이를 다시 열면 다음 화면이다. */
  const nextScreen = async (): Promise<void> => {
    if (busy || !channelReady()) return
    // 한 자리를 비워 두고 막는다 — 보내기가 **지금 화면을 하나 더** 붙이기 때문이다.
    // 꽉 채워 굳히게 두면 다 그려 놓고 보내는 순간에야 거절당한다.
    if (steps.length >= MAX_STEPS - 1) {
      say(`화면은 최대 ${MAX_STEPS}개입니다 — 지금 화면에서 마무리해 주세요`, 6000)
      return
    }
    setBusy(true)
    setEditingId(null)
    setMergeIds(null)
    setSketchFor(null)
    setReviewOpen(false)
    const frozen = await freezeScreen()
    setBusy(false)
    if (frozen) collapse()
  }

  const send = async (): Promise<void> => {
    if (marks.length === 0 || busy || !channelReady()) return
    setBusy(true)
    setEditingId(null)
    setMergeIds(null)
    setHover(null)
    setSketchFor(null)
    setReviewOpen(false)

    // 보내기도 먼저 지금 화면을 굳힌다 — 마지막 화면만 다른 길로 저장하면 그 화면에서만
    // 어긋나는 버그가 생긴다. 길은 하나여야 한다.
    //
    // 다만 **지금 화면에 그린 것이 없고 이미 굳힌 화면이 있으면 건너뛴다.** "다음 화면"으로
    // 넘어와 놓고 여기선 아무것도 안 그린 채 보내는 일이 흔한데, 그때마다 아무 표시도 없는
    // 화면이 흐름 끝에 붙으면 이야기가 엉뚱한 데서 끝난 것처럼 읽힌다.
    const drewHere = marks.some((m) => m.parts.some((p) => p.screen === screen))
    let flow: DraftStep[] = steps
    let folder = draftFolder
    if (drewHere || steps.length === 0) {
      const frozen = await freezeScreen()
      if (!frozen) {
        setBusy(false)
        return
      }
      // 방금 굳힌 것은 상태에 아직 안 들어왔다. 돌려받은 값을 손으로 이어 붙인다.
      flow = [...steps, frozen.step]
      folder = frozen.folder
    }
    if (!folder) {
      say('쌓아 둔 것이 없습니다')
      setBusy(false)
      return
    }

    try {
      const res = await window.rockury.devFeedback.save({
        draft: folder,
        // 화면 목록 순서가 곧 흐름 차례다. `seqs` 는 메인이 그림 파일 이름을 차례에
        // 맞춰 고쳐 짓는 데 쓴다(뜬 순서 → 흐름 순서).
        seqs: flow.map((s) => s.seq),
        steps: flow.map((s) => ({
          location: s.location,
          viewport: s.viewport,
          hasImage: s.hasImage
        })),
        marks: marks.map((m) => ({
          memo: m.memo,
          sketch: m.sketch,
          // 자국의 점들은 안 보낸다 — 그림은 shot-N.png 가 이미 담고 있고, 에이전트가
          // 쓰는 것은 좌표와 요소다. 화면 신원은 흐름 차례로 바꿔 보낸다.
          parts: m.parts.map((p) => ({
            kind: p.kind,
            bounds: p.bounds,
            target: p.target,
            step: flow.findIndex((s) => s.seq === p.screen) + 1
          }))
        })),
        logs: recentLogs()
      })
      setToast(
        res.missingImages > 0 ? `${res.saved} (그림이 빠진 화면 ${res.missingImages}개)` : res.saved
      )
      // 이미 메인으로 넘어갔으니 초안을 지우지 않는다 — close() 는 초안 지우기를 부른다.
      setDraftFolder(null)
      setMarks([])
      setSteps([])
      setNotice(null)
      // 다음 제보는 화면 번호가 1부터 다시 시작한다 — 남기면 남의 그림이 새 목록에 깔린다.
      setShots({})
      collapse()
    } catch (err) {
      console.error('[dev-feedback]', err)
      // 실패해도 초안은 메인에 남아 있다. 표시도 그대로 둔다 — 다시 그리게 하지 않고
      // 그대로 다시 보낼 수 있어야 한다.
      setToast(feedbackFailureMessage(err))
    } finally {
      setBusy(false)
      window.setTimeout(() => setToast(null), 6000)
    }
  }

  // 키보드 경로가 부르는 최신 값들. (ref 인 이유는 위 liveRef 주석 참고)
  liveRef.current = { marks, screen, send, nextScreen }

  const editing = marks.find((m) => m.id === editingId) ?? null
  // 메모창은 **지금 화면에 있는 첫 표시** 옆에 붙인다. 나중에 붙은 자국을 따라 창이
  // 옮겨 다니면 방금 무엇을 적고 있었는지 놓치고, 지난 화면의 좌표에 붙이면 아무것도
  // 없는 허공에 뜬다(화면을 걸친 묶음을 다시 열 때 실제로 그렇게 된다).
  const editingHere = editing ? (partsOnScreen(editing, screen)[0] ?? null) : null
  const bubble = editingHere ? bubblePosition(editingHere.bounds, dock) : null

  /**
   * 안내 한 줄. 갈래는 전부 **상태에서** 뽑는다(`hint.ts` 가 순서까지 안다).
   *
   * 특히 "고른 묶음은 있는데 이 화면엔 그 자국이 없다"가 그렇다 — 메모창이 붙을 데가 없어
   * 화면에서 사라지는 자리이고, 그 상태로 들어오는 길이 둘이다: 훑어보기에서 지난 화면의
   * 항목에 "이어 그리기", 그리고 걸친 묶음의 이 화면 자국만 지우개로 지우기. 어느 한쪽
   * 손잡이에 매달면 나머지 길이 조용히 빠진다.
   */
  const hint = feedbackHint({
    notice,
    // 번호는 묶음 id 가 아니라 **목록에서 몇 번째인가**다(markLabel 의 계약).
    pickedLabel: editing ? markLabel(marks.findIndex((m) => m.id === editing.id)) : null,
    pickedHasPartHere: editingHere !== null,
    steps: steps.length,
    marks: marks.length
  })

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
  const hoveredMark = editingId === null && hover ? (marks.find((m) => m.id === hover.id) ?? null) : null
  const hoveredBounds = hoveredMark?.parts[hover?.part ?? 0]?.bounds ?? null

  /** 훑어보기 목록 — 화면(단계)이 뼈대고 그 아래 그 화면의 항목이 달린다. */
  const screens = reviewScreens(steps, marks, { seq: screen, label: location.label })
  /** 훑어볼 것이 없는 동안은 손잡이를 잠근다 — 빈 목록을 여는 길은 뜻이 없다. */
  const nothingYet = marks.length === 0 && steps.length === 0

  /** 항목 하나를 지운다. 화면 여럿에 걸쳐 있어도 딸린 표시가 다 같이 간다. */
  const dropMark = (id: number): void => {
    setMarks((prev) => removeMark(prev, id))
    // 열려 있던 메모창·고르기가 없는 것을 가리키지 않게 같이 정리한다.
    if (editingId === id) setEditingId(null)
    setMergeIds((prev) => (prev ? prev.filter((picked) => picked !== id) : prev))
    setHover(null)
  }

  /** 걸친 항목에서 **한 화면 몫만** 뺀다. 다른 화면의 표시와 메모는 그대로 남는다. */
  const dropPartsOnScreen = (id: number, seq: number): void => {
    const mark = marks.find((m) => m.id === id)
    setMarks((prev) => removePartsOnScreen(prev, id, seq))
    // 이 화면 몫이 그 항목의 전부였으면 항목째 사라진다.
    if (editingId === id && mark?.parts.every((p) => p.screen === seq)) setEditingId(null)
    setHover(null)
  }

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
          aria-label={
            steps.length > 0
              ? `화면 피드백 이어 남기기 (화면 ${steps.length}개 쌓임)`
              : '화면 피드백 남기기'
          }
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
            // 쌓는 중이면 흐릿하게 두지 않는다. 남긴 것이 있다는 걸 잊고 앱을 쓰다가
            // 창을 닫아 버리면 그동안 그린 것이 통째로 사라진다.
            opacity: steps.length > 0 ? 1 : 0.35,
            touchAction: 'none',
            pointerEvents: 'auto',
            ...NO_DRAG
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = steps.length > 0 ? '1' : '0.35')}
        >
          <span style={{ height: 64, width: 6, borderRadius: '4px 0 0 4px', background: MARK_COLOR }} />
        </button>
        {/* 접힌 동안의 진행 표시. 손잡이 옆에 붙여 두면 앱을 쓰는 내내 눈에 걸린다. */}
        {steps.length > 0 ? (
          <div
            style={{
              ...PANEL,
              position: 'absolute',
              right: 14,
              top: `${handleTop}%`,
              transform: 'translateY(-50%)',
              borderRadius: 999,
              padding: '4px 10px',
              font: '500 11px/1.5 system-ui, sans-serif',
              pointerEvents: 'none'
            }}
          >
            화면 {steps.length} · 표시 {marks.length}
          </div>
        ) : null}
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
          cursor: tool === 'eraser' ? 'pointer' : hover !== null ? 'pointer' : 'crosshair'
        }}
        onPointerDown={onDrawDown}
        onPointerMove={onDrawMove}
        onPointerUp={onDrawUp}
        onPointerCancel={onDrawUp}
        onPointerLeave={() => setHover(null)}
      >
        {/* 자국 — 스케치판이 굽는 PNG 와 같은 기하(draw.ts)를 읽는다. 각자 그리면 화면에서
            본 것과 저장된 그림이 조용히 어긋난다.
            **지금 화면의 것만 그린다.** 지난 화면 자국은 이미 자기 그림에 구워졌고,
            좌표가 그 화면 기준이라 여기 그리면 엉뚱한 자리를 가리키는 낙서가 된다. */}
        {[...marks.flatMap((m) => partsOnScreen(m, screen).map((p) => p.shape)), draft].map(
          (shape, si) =>
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
        {/* 배지 — 묶음 안의 표시는 **전부 같은 번호**를 단다. 화면에 ① 이 세 군데 있으면
            그 셋이 한 이야기라는 뜻이고, 어느 것을 눌러도 같은 메모가 열린다. */}
        {marks.map((m, i) =>
          partsOnScreen(m, screen).map((part, pi) => {
            const c = badgeCenter(part.bounds)
            const active = hover?.id === m.id || editingId === m.id
            return (
              <g key={`badge-${m.id}-${pi}`}>
                {/* 눌러서 다시 열 수 있다는 신호. 묶음 전체에 켜져, 어느 자국들이 한 식구인지도
                    같이 보인다. 판정 자체는 badgeHit 가 한다. */}
                {active && !capturing ? (
                  <circle cx={c.x} cy={c.y} r={BADGE_RADIUS + 4} fill={MARK_COLOR} opacity={0.25} />
                ) : null}
                {/* 핀은 자국이 없어 배지 하나만 뜬다 — 조준 링을 둘러 "이 한 점"임을 보인다. */}
                {part.kind === 'pin' ? (
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
                {/* 그림이 딸린 묶음은 첫 배지 어깨에 점 하나 — 목록을 안 열어도 어디에 그림이
                    붙었는지 보인다. 그림은 묶음당 한 장이라 배지마다 찍지 않는다.
                    저장되는 그림에는 넣지 않는다(도구의 표식이지 지적이 아니다). */}
                {m.sketch && pi === 0 && !capturing ? (
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
          })
        )}
      </svg>

      {toastNode}

      {/* 아래는 전부 "도구" — 창을 찍는 동안에는 그림에 들어가지 않도록 걷어낸다.
          스케치판·흐름이 떠 있을 때도 걷는다: 뒤에 가려 안 보이는데 DOM 에 남아 있으면 탭
          이동이 보이지도 않는 버튼으로 새고, 도구 버튼이 두 벌이 되어 어느 쪽이 지금 쓰는
          것인지 알 수 없다. */}
      {capturing || sketching || reviewOpen ? null : (
        <>
          {/* 배지 위 미리보기. 눌러서 열지 않고도 무엇을 적었는지 확인만 하고 지나갈 수 있다. */}
          {hoveredMark && hoveredBounds ? (
            <div
              style={{
                position: 'absolute',
                top: Math.max(4, badgeCenter(hoveredBounds).y - BADGE_RADIUS - 30),
                left: clamp(
                  badgeCenter(hoveredBounds).x - BADGE_RADIUS,
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
              {hoveredMark.memo.trim() || '(메모 없음)'}
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
              {/* 쌓은 것을 보고 고치는 한 자리. 예전엔 목록(보기)과 흐름(화면 다루기)으로
                  갈려 있었고, 어느 쪽에서도 지난 화면의 항목을 못 만졌다. */}
              <button
                type="button"
                style={{ ...BTN, opacity: nothingYet ? 0.4 : 1 }}
                disabled={nothingYet}
                onClick={() => {
                  setReviewOpen(true)
                  setEditingId(null)
                  setMergeIds(null)
                  setHover(null)
                }}
              >
                훑어보기
              </button>
              <button
                type="button"
                style={{ ...BTN, opacity: marks.length === 0 ? 0.4 : 1 }}
                disabled={marks.length === 0}
                onClick={undoLastPart}
              >
                되돌리기
              </button>
              {/*
                "다음 화면" — 지금 화면을 그림으로 굳히고 오버레이를 접는다. 접힌 동안 앱을
                자유롭게 쓰고, 손잡이를 다시 열면 그 화면이 다음 단계가 된다. 이 버튼이 곧
                **화면을 떠나기 전에 굳히는 순간**이라, 좌표가 다른 화면으로 새지 않는다.
              */}
              <button
                type="button"
                style={{ ...BTN, opacity: busy ? 0.4 : 1 }}
                disabled={busy}
                onClick={() => void nextScreen()}
              >
                다음 화면
              </button>
              <button type="button" style={BTN} onClick={close}>
                닫기
              </button>
              <button
                type="button"
                disabled={marks.length === 0 || busy}
                title="보내기 (⌘/Ctrl+Enter)"
                onClick={() => void send()}
                style={{
                  ...BTN,
                  background: MARK_COLOR,
                  color: '#fff',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontWeight: 600,
                  opacity: marks.length === 0 || busy ? 0.4 : 1
                }}
              >
                {busy ? '저장 중' : `보내기${marks.length > 0 ? ` ${marks.length}` : ''}`}
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

            {/* 안내 한 줄 — 무엇을 띄울지는 `hint.ts` 가 정한다(자리를 넷이 나눠 쓴다). */}
            {hint ? (
              <span
                data-feedback-hint={hint.kind}
                style={{
                  ...PANEL,
                  boxShadow: 'none',
                  borderRadius: 999,
                  padding: '2px 10px',
                  // 알림과 이어 그리기만 색을 준다 — 앞은 물러날 것을, 뒤는 손댈 것을 알린다.
                  color: hint.kind === 'notice' || hint.kind === 'resume' ? MARK_COLOR : '#64748b',
                  font: '400 11px/1.6 system-ui, sans-serif'
                }}
              >
                {hint.text}
              </span>
            ) : null}
          </div>

          {/* 묶음마다 붙는 메모 입력창 */}
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
                  {/* 훑어보기와 달리 여기서는 사슬을 통째로 보인다 — 자리가 있고, 어느 파일로
                      가야 하는지가 첫 이름 하나보다 사슬 전체에서 훨씬 빨리 나온다. */}
                  {editing.parts[0]?.target?.components.join(' ‹ ') ||
                    editing.parts[0]?.target?.tag ||
                    '빈 자리'}
                  {editing.parts.length > 1 ? ` · 표시 ${editing.parts.length}개` : ''}
                  {/* 다른 화면에도 이 묶음의 표시가 있으면 밝힌다 — 안 보이는 곳에 딸린 것을
                      모르면 "풀기"나 "지우기"가 무엇을 건드리는지 알 수 없다. */}
                  {screenSpan(editing) > 1 ? ` · 화면 ${screenSpan(editing)}개` : ''}
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
              {/* 이 도구에서 새로 배워야 할 규칙은 이 한 줄이 전부다. 지금 보고 있는
                  자리(메모창 안)에 두지 않으면 아무도 안 읽는다. */}
              <p
                style={{
                  margin: '6px 0 0',
                  color: '#94a3b8',
                  font: '400 11px/1.4 system-ui, sans-serif'
                }}
              >
                이 창이 열려 있는 동안 더 그리면 이 메모에 함께 묶입니다
              </p>
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
                {/* 잘못 묶었을 때의 되돌릴 길. 묶기만 있고 풀기가 없으면 실수한 사람은
                    다 지우고 처음부터 다시 해야 한다. */}
                {editing.parts.length > 1 ? (
                  <button
                    type="button"
                    style={BTN}
                    onClick={() => {
                      setMarks((prev) => splitMark(prev, editing.id, () => nextId.current++))
                      setEditingId(null)
                    }}
                  >
                    풀기
                  </button>
                ) : null}
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

      {/* 훑어보기 — 스케치판과 같은 자리를 쓴다(둘 다 화면 위 그리기를 덮는다). */}
      {reviewOpen && !sketching && !capturing ? (
        <ReviewModal
          screens={screens}
          shots={shots}
          topInset={TITLEBAR_H}
          notice={notice}
          mergeIds={mergeIds}
          markCount={marks.length}
          onMove={(index, delta) => setSteps((prev) => moveStep(prev, index, delta))}
          onRemoveScreen={(index) => {
            const next = removeStep(steps, marks, index)
            setSteps(next.steps)
            setMarks(next.marks)
            // 남의 항목까지 사라질 수 있는 동작이라 조용히 넘기지 않는다.
            const lost = marks.length - next.marks.length
            say(
              lost > 0 ? `화면을 뺐습니다 · 딸린 항목 ${lost}개도 같이 사라졌습니다` : '화면을 뺐습니다'
            )
          }}
          onMemo={(id, memo) => setMarks((prev) => setMemo(prev, id, memo))}
          onSketch={setSketchFor}
          onRemoveMark={dropMark}
          onRemovePartsOnScreen={dropPartsOnScreen}
          onResume={(id) => {
            // 이어 그리려면 화면이 보여야 한다 — 고르고 이 패널을 접는다. 그다음은 안내
            // 한 줄이 받는다("여기서 그리면 ① 에 이어 붙습니다").
            setEditingId(id)
            setReviewOpen(false)
          }}
          onStartMerge={() => setMergeIds([])}
          onCancelMerge={() => setMergeIds(null)}
          onToggleMerge={(id) =>
            setMergeIds((prev) =>
              prev === null
                ? [id]
                : prev.includes(id)
                  ? prev.filter((picked) => picked !== id)
                  : [...prev, id]
            )
          }
          onApplyMerge={applyMerge}
          onClose={() => {
            setReviewOpen(false)
            setMergeIds(null)
          }}
        />
      ) : null}
    </div>
  )
}
