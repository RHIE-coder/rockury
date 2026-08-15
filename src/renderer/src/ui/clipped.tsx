import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * **잘린 칸을 그 자리에서 펼친다** — 손잡이는 넘치는 칸에만 달린다.
 *
 * 앞서 두 번 틀렸다. ⑴ 호버 툴팁(`title`)만 뒀더니 "전체 내용을 볼 수 있는 방법이 없어"였다
 * (2026-08-12) — 마우스를 올려야 나오는 것은 없는 것과 같다. ⑵ 그래서 표 머리에 "전문 보기"
 * 체크박스를 달았는데 이번엔 그 체크박스가 걸렸다(2026-08-12: "좀 더 우아한 방법 없어?").
 * 셋째 답: **머리에는 아무것도 안 둔다.** 넘치는 칸이 스스로 ⌄ 를 내밀고, 그 칸만 펴진다.
 *
 * 잘렸는지는 **재야만 안다** — 글자 수로는 못 센다(열 폭이 패널 크기에 따라 변하고 글꼴도
 * 비례 폭이다). 그래서 실제 `scrollWidth` 를 보고, 폭이 바뀔 때마다 다시 잰다.
 */

/**
 * 이번 측정을 **답으로 받아들일지** 가른다 — 못 쓰는 측정이면 `null`(=이전 답을 그대로 둔다).
 *
 * 폭 0 은 "안 넘침"이 아니라 **잴 수 없음**이다. 이 구분이 없어서 실제로 손잡이가 사라졌다:
 * 칸을 눌러 편집을 열면 그 칸이 입력 상자로 바뀌며 DOM 에서 빠지는데, 빠지는 순간
 * `ResizeObserver` 가 "크기 0" 으로 한 번 울린다. 그 0 을 `0 - 0 > 1 = 거짓` 으로 받아 적으면
 * 손잡이가 사라지고, 편집을 닫아도 다시 잴 계기가 없어 **영영 안 돌아왔다**
 * (2026-08-13 사용자: "편집 이후에 다시 나오면 또 이러는데?").
 *
 * 1px 여유는 소수점 반올림 몫이다 — 딱 맞는 칸이 손잡이를 달고 껌뻑이는 것을 막는다.
 */
export function clipVerdict(scrollWidth: number, clientWidth: number): boolean | null {
  if (clientWidth <= 0) return null
  return scrollWidth - clientWidth > 1
}

export function useClipped<T extends HTMLElement>(
  /** 이 칸이 담은 **글자**. 바뀌면 접는다 — 그래서 반드시 원시값이어야 한다(children 은 렌더마다 새 객체다). */
  text: string
): {
  /** 자르는 상자에 건다 — 여기를 재서 손잡이를 낼지 정한다. */
  ref: (node: T | null) => void
  /** 접힌 채로 내용이 넘친다 = 손잡이를 달 자리 */
  clipped: boolean
  expanded: boolean
  toggle: () => void
} {
  const [clipped, setClipped] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const nodeRef = useRef<T | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  // 재는 시점에 읽어야 하는 값이라 ref 로 든다 — 콜백이 옛 값을 물고 있으면 판정이 얼어붙는다.
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const measure = useCallback((): void => {
    // 펼친 동안은 잴 수 없다(줄을 바꿨으니 넘치지 않는다) — 접는 손잡이를 남기려면 판정을 얼린다.
    if (expandedRef.current) return
    const el = nodeRef.current
    if (!el) return
    const verdict = clipVerdict(el.scrollWidth, el.clientWidth)
    if (verdict !== null) setClipped(verdict)
  }, [])

  /**
   * **붙는 칸이 바뀌면 관찰도 그 칸으로 옮긴다.** 편집을 여닫으면 이 칸은 실제로 죽고 새로
   * 태어나는데, 예전에는 처음 붙은 칸 하나를 계속 보고 있어서 ⑴ 빠진 칸의 0 을 답으로 받고
   * ⑵ 새로 태어난 칸은 아무도 안 봤다. 콜백 ref 는 태어남·죽음을 그때그때 알려준다.
   */
  const ref = useCallback(
    (node: T | null): void => {
      nodeRef.current = node
      roRef.current?.disconnect()
      roRef.current = null
      if (!node) return
      // 열 폭은 패널을 끌면 바뀐다 — 그때 손잡이가 생기거나 사라져야 한다.
      const ro = new ResizeObserver(measure)
      ro.observe(node)
      roRef.current = ro
      measure()
    },
    [measure]
  )

  // 글자가 바뀌면 접는다 — 편집으로 짧아진 칸이 펼친 채로 남으면 빈 줄만 늘어난다.
  useEffect(() => setExpanded(false), [text])

  useLayoutEffect(() => {
    measure()
    /*
     * **한 번만 재면 틀린 답이 영영 남는다.** `ResizeObserver` 는 이 칸의 *상자*가 바뀔 때만
     * 울리는데, 넘치는지를 가르는 것은 상자가 아니라 **글자 폭**이다. 글꼴이 늦게 붙거나
     * 첫 그림이 배치가 앉기 전에 잡히면 답이 굳는다. 그래서 두 번 더 잰다:
     * 다음 그림 직후(배치가 앉은 뒤)와 글꼴이 다 붙은 뒤.
     */
    const raf = requestAnimationFrame(measure)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [measure, text, expanded])

  // 컴포넌트가 사라질 때만 관찰을 끊는다(칸 교체는 위 콜백 ref 가 맡는다).
  useEffect(() => () => roRef.current?.disconnect(), [])

  return { ref, clipped, expanded, toggle: () => setExpanded((v) => !v) }
}

/** 자르기 / 줄바꿈 두 모습 — 쓰는 곳마다 같은 글자를 적지 않게 여기 둔다. */
export const clipBox = (expanded: boolean): string =>
  expanded ? 'whitespace-pre-wrap break-words' : 'truncate'

/**
 * 펼침·접힘 손잡이 — 잘린 칸의 오른쪽 끝에 붙는다.
 *
 * 평소엔 흐리게 있다가 줄에 마우스를 올리면 진해진다(`group-hover`) — 표 서른 줄에 ⌄ 가
 * 또렷하게 서 있으면 그것만 보인다. 다만 **투명하게 숨기지는 않는다**: 안 보이는 손잡이는
 * 툴팁과 같은 실패다.
 */
export function ClipToggle({
  expanded,
  onToggle,
  className
}: {
  expanded: boolean
  onToggle: () => void
  className?: string
}): ReactElement {
  const Icon = expanded ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      // 칸 자체가 다른 일을 하는 자리가 있다(설계부 칸은 누르면 편집이 열린다) — 손잡이만 먹는다.
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      // 편집 중인 이웃 칸의 blur(=커밋)보다 이 클릭이 먼저 처리되게(EditableText 관례).
      onMouseDown={(e) => e.preventDefault()}
      // 검사 손잡이 — 아이콘이 바뀌어도 이 이름은 안 바뀐다.
      data-clip-toggle={expanded ? 'open' : 'closed'}
      aria-label={expanded ? '접기' : '전문 보기'}
      aria-expanded={expanded}
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center self-start rounded text-muted/50 transition-colors hover:bg-panel-strong hover:text-fg group-hover:text-muted',
        className
      )}
    >
      <Icon className="size-3" />
    </button>
  )
}
