import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Plus, SquareArrowOutUpRight, X } from 'lucide-react'
import { resolveTab, useNav } from '../nav/useNav'
import { DRAG_SLOP, dropIndexAt, pulledOutOfStrip, tabTitle, type NavTab } from '../nav/tabs'
import { cx } from '../lib/cx'
import { openInNewWindow, useWindowCommands } from './windowCommands'

/**
 * L0 — 브라우저 탭 줄(2026-08-05 사용자 요청: "여러 화면을 계속 대조하며 본다").
 *
 * 아래 두 줄(모듈 탭·뷰 탭)과 뜻이 다르다. 그 둘은 **고정 메뉴**로 지금 서비스가 가진 화면을
 * 늘 같은 순서로 보여 주고, 이 줄은 **사용자가 만든 자리 묶음**이라 서비스를 가로질러 섞인다.
 * 그래서 탭마다 서비스 아이콘이 서고(어느 서비스 것인지가 줄 안에서 갈려야 한다), 아래 두 줄은
 * 활성 탭의 서비스 것만 그린다.
 *
 * **줄 하나만 늘린다**(사용자 선택). 세로가 빠듯한 화면이라 높이를 32px(`h-8`)로 조인다 —
 * 제목 줄(36px)보다도 얕다. 대신 탭이 늘면 이름이 줄고(`truncate`) 줄 자체는 안 늘어난다.
 *
 * 끌기는 두 가지 일을 한다 — **줄을 벗어났나가 가른다**(2026-08-06 사용자 요청, 브라우저와 같게):
 *   줄 안에서 옮기면 → 자리 바꾸기 · 줄 밖으로 빼내면 → 그 자리에서 창이 되어 손을 따라온다.
 *   그 창을 다른 창(혹은 원래 창)의 탭 줄 위에서 놓으면 그 줄이 도로 삼킨다.
 *   **마지막 한 장이면 이 창째** 끌린다 — 떼어내 봐야 빈 창이 남을 뿐이라 남길 창이 곧 끌 창이다.
 *
 * **브라우저 기본 끌기(HTML5 drag-and-drop)를 안 쓴다.** 그쪽은 놓는 순간에야 결과를 알려 줘서
 * "빼내는 즉시 창"이 안 되고, 판정할 것이 놓은 좌표뿐이라 창을 꽉 채워 놓으면 창 밖이 없어
 * 영영 안 떨어졌다(예전 코드가 여기서 막혔다). 창을 넘나드는 끌기도 그쪽으로는 안 이어진다.
 */
export function TabBar() {
  const tabs = useNav((s) => s.tabs)
  const activeId = useNav((s) => s.activeTabId)
  const openTab = useNav((s) => s.openTab)
  const closeTab = useNav((s) => s.closeTab)
  const selectTab = useNav((s) => s.selectTab)

  const stripRef = useRef<HTMLDivElement>(null)
  /** 지금 끌고 있는 탭(줄 안에 있을 때만 — 창으로 떨어져 나가면 이 줄에서 사라진다). */
  const [dragId, setDragId] = useState<string | null>(null)
  /** 떨어질 자리(0 ~ 탭 수). 내 줄에서 옮기는 중이든 다른 창에서 건너오는 중이든 표시는 같다. */
  const [dropAt, setDropAt] = useState<number | null>(null)

  useWindowCommands()

  /**
   * 줄에 선 탭들의 가로 상자 — 어느 틈에 떨어질지 재는 데 쓴다.
   *
   * React 상태가 아니라 **화면에서 직접** 읽는다: 탭 폭은 이름 길이·줄 넘침(가로 스크롤)에 따라
   * 그때그때 다르고, 다른 창에서 건너온 탭의 자리도 같은 자로 재야 표시와 결과가 안 어긋난다.
   */
  const tabBoxes = useCallback((): { left: number; width: number }[] => {
    const strip = stripRef.current
    if (!strip) return []
    return [...strip.querySelectorAll<HTMLElement>('[data-nav-tab]')].map((el) => {
      const box = el.getBoundingClientRect()
      return { left: box.left, width: box.width }
    })
  }, [])

  // 탭 줄이 창 안 어디인지 메인에 알린다 — 끌고 온 탭을 어느 창이 삼킬지는 창 밖에서 가른다.
  // **창 기준 좌표**로 보낸다: 화면 좌표로 보내면 사용자가 창을 옮긴 순간 낡는데(창 이동에는
  // resize 가 안 온다) 옮겨진 것을 이쪽은 모른다.
  useEffect(() => {
    const report = (): void => {
      const box = stripRef.current?.getBoundingClientRect()
      if (!box) return
      window.rockury?.window?.strip?.({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height
      })
    }
    report()
    window.addEventListener('resize', report)
    return () => window.removeEventListener('resize', report)
  }, [])

  // 다른 창에서 끌어 온 탭 — 오는 동안은 자리만 표시하고, 놓으면 그 자리에 끼운다.
  useEffect(() => {
    const offHover = window.rockury?.window?.onDragHover?.((x) =>
      setDropAt(x === null ? null : dropIndexAt(tabBoxes(), x))
    )
    const offAdopt = window.rockury?.window?.onAdopt?.(({ loc, x }) => {
      useNav.getState().adoptTab(loc, dropIndexAt(tabBoxes(), x))
      setDropAt(null)
    })
    return () => {
      offHover?.()
      offAdopt?.()
    }
  }, [tabBoxes])

  /**
   * 끌고 있는 한 사건. 상태가 아니라 ref 로 든다 — 마우스 움직임마다 그림을 다시 그리면
   * 끌기가 뻑뻑해지고, 그림보다 늦게 오는 값(떨어져 나간 창 번호)을 상태로 받으면 한 박자 전
   * 값을 읽는다.
   */
  const drag = useRef<{
    id: string
    /** 창 왼위에서 탭을 잡은 지점까지. 끌기 시작 판정의 기준점이기도 하다. */
    grab: { x: number; y: number }
    started: boolean
    /**
     * 손에 끌려가는 창 번호 — 떼어낸 새 창이거나, **마지막 한 장이면 이 창 자신**이다.
     * 정해지고 나면 이후 움직임은 그 창을 옮기는 일이 된다.
     */
    windowId: number | null
    /** 창을 세우는 중 — 답이 오기 전에 또 부르면 한 탭이 두 창이 된다. */
    tearing: boolean
  } | null>(null)

  useEffect(() => {
    /**
     * 줄 밖으로 빼냈다 — 탭이 여럿이면 그 탭만 창으로 떼어내고, **마지막 한 장이면 이 창째** 끈다
     * (브라우저와 같다). 한 장을 떼어내 봐야 빈 창이 남을 뿐이라, 남길 창이 곧 끌고 갈 창이다.
     */
    const pullOut = async (d: NonNullable<typeof drag.current>, at: { x: number; y: number }) => {
      const nav = useNav.getState()
      let id: number | null
      if (nav.tabs.length > 1) {
        const loc = nav.detachTab(d.id)
        if (!loc) {
          d.tearing = false
          return
        }
        id = (await window.rockury.window.tearOff({ loc, at, grab: d.grab })) ?? null
      } else {
        id = (await window.rockury.window.dragSelf()) ?? null
      }
      d.tearing = false
      setDragId(null)
      setDropAt(null)
      if (id === null) return
      // 창을 세우는 사이에 손을 놓았을 수 있다 — 그러면 여기서 바로 끌기를 끝맺는다.
      if (drag.current === d) d.windowId = id
      else void window.rockury.window.dragEnd({ id, at })
    }

    const move = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return

      if (!d.started) {
        if (Math.abs(e.clientX - d.grab.x) < DRAG_SLOP && Math.abs(e.clientY - d.grab.y) < DRAG_SLOP)
          return
        d.started = true
        setDragId(d.id)
      }

      const at = { x: e.clientX, y: e.clientY }
      if (d.windowId !== null)
        return window.rockury.window.dragMove({ id: d.windowId, at, grab: d.grab })
      if (d.tearing) return

      const strip = stripRef.current?.getBoundingClientRect()
      if (strip && pulledOutOfStrip(e.clientY, strip)) {
        d.tearing = true
        void pullOut(d, at)
        return
      }
      setDropAt(dropIndexAt(tabBoxes(), e.clientX))
    }

    const up = (e: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      drag.current = null
      setDragId(null)
      setDropAt(null)

      if (d.windowId !== null) {
        void window.rockury.window.dragEnd({ id: d.windowId, at: { x: e.clientX, y: e.clientY } })
        return
      }
      // 창을 세우는 중이었으면 그쪽이 끝맺는다(위 pullOut). 안 움직였으면 그냥 고른 것이다.
      if (!d.started || d.tearing) return

      const nav = useNav.getState()
      const at = dropIndexAt(tabBoxes(), e.clientX)
      const from = nav.tabs.findIndex((t) => t.id === d.id)
      // 자기보다 뒤로 옮길 때는 자기가 빠지면서 뒤엣것들이 한 칸 당겨진다.
      nav.moveTab(d.id, at > from ? at - 1 : at)
    }

    // 창 전체에서 듣는다 — 탭 위에서만 들으면 커서가 창 밖으로 나간 순간 끌기가 끊긴다.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [tabBoxes])

  const beginDrag = (e: ReactPointerEvent, id: string): void => {
    if (e.button !== 0) return
    // 여기서 탭을 고르지 않는다 — 자리를 옮기는 것과 보는 것은 다른 일이다(`tabs.moveTab`).
    // 그냥 누르기만 했으면 안쪽 단추의 클릭이 골라 준다.
    drag.current = {
      id,
      grab: { x: e.clientX, y: e.clientY },
      started: false,
      windowId: null,
      tearing: false
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-line bg-panel">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="열린 화면"
        className="flex min-w-0 flex-1 select-none items-stretch overflow-x-auto"
      >
        {tabs.map((tab, i) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            // 한 장뿐이면 닫기를 안 그린다 — 닫아도 안 닫히는 단추는 눌러 본 사람을 헷갈리게 한다
            // (마지막 장은 ⌘W 로 창째 닫는다).
            closable={tabs.length > 1}
            dragging={dragId === tab.id}
            dropSide={
              dropAt === i ? 'before' : dropAt === i + 1 && i === tabs.length - 1 ? 'after' : null
            }
            onSelect={() => selectTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onPointerDown={(e) => beginDrag(e, tab.id)}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1.5">
        <BarButton action="new-tab" label="이 화면을 새 탭으로 (⌘T)" onClick={() => openTab()}>
          <Plus size={14} />
        </BarButton>
        <BarButton
          action="new-window"
          label="이 화면을 새 창으로 (⌘N)"
          onClick={() => openInNewWindow()}
        >
          <SquareArrowOutUpRight size={13} />
        </BarButton>
      </div>
    </div>
  )
}

/**
 * 탭 한 장. 활성은 **줄 위로 떠오른 흰 카드**다 — 아래 뷰 탭 줄이 쓰는 어법과 같게 맞췄다
 * (한 화면에 두 가지 "지금 여기" 표시가 있으면 어느 쪽이 현재인지 안 갈린다).
 *
 * 고르기와 닫기는 **형제 단추**다. 닫기를 고르기 안에 넣으면 단추 안 단추가 되어 HTML 이 깨지고,
 * 브라우저에 따라 닫기 클릭이 고르기로도 먹는다.
 */
function Tab({
  tab,
  active,
  closable,
  dragging,
  dropSide,
  onSelect,
  onClose,
  onPointerDown
}: {
  tab: NavTab
  active: boolean
  closable: boolean
  dragging: boolean
  /** 끌고 온 탭이 이 탭의 어느 쪽에 떨어질지 — 그 자리에 세로선을 세운다. */
  dropSide: 'before' | 'after' | null
  onSelect: () => void
  onClose: () => void
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const { service, module, view } = resolveTab(tab)
  const Icon = service.icon
  const title = tabTitle(module, view)

  return (
    <div
      onPointerDown={onPointerDown}
      // e2e·화면 게이트 훅 — 어느 탭이 떠 있고 어느 것이 켜졌는지를 모양이 아니라 역할로 집는다.
      data-nav-tab={tab.id}
      data-nav-tab-active={active ? '' : undefined}
      className={cx(
        'group relative flex min-w-0 max-w-[190px] shrink-0 items-center border-r border-line pr-1 transition-colors',
        active ? 'bg-canvas' : 'text-muted hover:bg-canvas/50',
        // 끌려 나온 탭은 흐려진다 — 원래 자리에 그대로 짙게 있으면 무엇을 옮기는 중인지 안 보인다.
        dragging && 'opacity-40'
      )}
    >
      {/* 떨어질 자리 표시 — 줄 높이를 꽉 채운 가는 선 하나. 어느 틈으로 들어갈지만 말한다. */}
      {dropSide && (
        <span
          aria-hidden
          data-tab-drop={dropSide}
          className={cx(
            'absolute inset-y-0 w-0.5 bg-accent',
            dropSide === 'before' ? 'left-0' : 'right-0'
          )}
        />
      )}

      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        title={`${service.label} · ${title}`}
        className={cx(
          'flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 pr-1 text-[12px]',
          active ? 'font-medium text-fg' : 'hover:text-fg'
        )}
      >
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{title}</span>
      </button>

      {closable && (
        <button
          type="button"
          aria-label="탭 닫기"
          // 닫기는 끌기가 아니다 — 안 막으면 × 를 누르는 순간 탭 끌기가 함께 시작된다.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          // 안 켜진 탭의 닫기는 마우스를 올렸을 때만 보인다 — 줄에 ×가 여러 개 늘어서면
          // 탭 이름보다 ×가 먼저 눈에 들어온다. 키보드로 짚으면 그때도 보인다.
          className={cx(
            'flex size-4 shrink-0 items-center justify-center rounded text-muted transition-[color,background-color,opacity]',
            'hover:bg-panel-strong hover:text-fg focus-visible:opacity-100',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

function BarButton({
  action,
  label,
  onClick,
  children
}: {
  /** e2e·화면 게이트가 집는 이름. 문구(`label`)와 갈라 둔다 — 문구는 다듬으면 바뀌지만 이건 안 바뀐다. */
  action: string
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tab-action={action}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-strong hover:text-fg"
    >
      {children}
    </button>
  )
}
