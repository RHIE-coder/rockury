import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Plus, SquareArrowOutUpRight, X } from 'lucide-react'
import { resolveTab, useNav } from '../nav/useNav'
import { droppedOutside, tabTitle, type NavTab } from '../nav/tabs'
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
 * 끌기는 두 가지 일을 한다 — **놓은 자리가 가른다**:
 *   줄 안에 놓으면 → 자리 옮기기 · 창 밖에 놓으면 → 그 탭이 창으로 떨어져 나간다.
 */
export function TabBar() {
  const tabs = useNav((s) => s.tabs)
  const activeId = useNav((s) => s.activeTabId)
  const openTab = useNav((s) => s.openTab)
  const closeTab = useNav((s) => s.closeTab)
  const selectTab = useNav((s) => s.selectTab)
  const moveTab = useNav((s) => s.moveTab)
  const detachTab = useNav((s) => s.detachTab)

  // 끌고 있는 탭과, 지금 그것이 떨어질 자리. 자리를 안 그려 두면 놓을 때까지 결과를 알 수 없다.
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  // 줄 안에 놓였나. 끝맺음(`dragend`)이 그림 그리기보다 늦게 오므로 상태가 아니라 ref 로 든다 —
  // 상태로 두면 끝맺음이 한 그림 전 값을 읽는다.
  const droppedInStrip = useRef(false)

  useWindowCommands()

  const endDrag = (): void => {
    setDragging(null)
    setDropAt(null)
  }

  /**
   * 끌기가 끝났다 — **줄 안에 안 놓였고** 끝난 자리가 창 밖이면 떼어낸다(브라우저에서 탭을
   * 끌어 내리는 것과 같다).
   *
   * "줄 안에 안 놓였다"를 먼저 보는 이유: 끝맺음은 놓기가 끝난 **뒤에도** 온다. 좌표만 보고
   * 판정하면, 자리를 옮기려고 줄 안에 잘 놓은 탭이 곧이어 떨어져 나간다. 게다가 좌표는 늘
   * 믿을 것이 못 된다 — 자동 검사가 만드는 끌기는 화면 좌표 대신 창 안 좌표를 실어 보낸다(실측).
   */
  const handleDragEnd = (e: DragEvent, id: string): void => {
    if (!droppedInStrip.current && droppedOutside(e, window)) {
      const place = detachTab(id)
      if (place) openInNewWindow(place)
    }
    endDrag()
  }

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-line bg-panel">
      <div
        role="tablist"
        aria-label="열린 화면"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        onDragOver={(e) => e.preventDefault()}
      >
        {tabs.map((tab, i) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            // 한 장뿐이면 닫기를 안 그린다 — 닫아도 안 닫히는 단추는 눌러 본 사람을 헷갈리게 한다
            // (마지막 장은 ⌘W 로 창째 닫는다).
            closable={tabs.length > 1}
            dragging={dragging === tab.id}
            dropSide={
              dropAt === i ? 'before' : dropAt === i + 1 && i === tabs.length - 1 ? 'after' : null
            }
            onSelect={() => selectTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onDragStart={() => {
              droppedInStrip.current = false
              setDragging(tab.id)
            }}
            onDragEnd={(e) => handleDragEnd(e, tab.id)}
            onDragOver={(e) => {
              if (!dragging) return
              e.preventDefault()
              // 반보다 왼쪽이면 이 탭 앞, 오른쪽이면 뒤 — 끌어 온 자리에 그대로 꽂히는 느낌.
              const box = e.currentTarget.getBoundingClientRect()
              setDropAt(e.clientX < box.left + box.width / 2 ? i : i + 1)
            }}
            onDrop={(e) => {
              e.preventDefault()
              droppedInStrip.current = true
              if (!dragging || dropAt === null) return endDrag()
              const from = tabs.findIndex((t) => t.id === dragging)
              // 자기보다 뒤로 옮길 때는 자기가 빠지면서 뒤엣것들이 한 칸 당겨진다.
              moveTab(dragging, dropAt > from ? dropAt - 1 : dropAt)
              endDrag()
            }}
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
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: {
  tab: NavTab
  active: boolean
  closable: boolean
  dragging: boolean
  /** 끌고 온 탭이 이 탭의 어느 쪽에 떨어질지 — 그 자리에 세로선을 세운다. */
  dropSide: 'before' | 'after' | null
  onSelect: () => void
  onClose: () => void
  onDragStart: () => void
  onDragEnd: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}) {
  const { service, module, view } = resolveTab(tab)
  const Icon = service.icon
  const title = tabTitle(module, view)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
