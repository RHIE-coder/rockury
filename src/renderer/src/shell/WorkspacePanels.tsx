import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { cx } from '../lib/cx'

interface WorkspacePanelsProps {
  /** 워크스페이스 내부 좌측 서브 사이드바 내용 (전역 크롬과 별개). */
  sidebar: ReactNode
  sidebarTitle?: string
  /** 사이드바 헤더 우측 액션 슬롯 (예: + 버튼). */
  sidebarActions?: ReactNode
  children: ReactNode
  /** 사이드바 기본 너비(%) */
  defaultSize?: number
  autoSaveId?: string
  /**
   * 사이드바를 접을 수 있게 한다 — 접으면 좁은 세로 띠만 남고 본문이 그만큼 넓어진다.
   * 기본은 꺼둔다: 이미 이 부품을 쓰던 화면들의 모양을 요청 없이 바꾸지 않는다.
   */
  collapsible?: boolean
  /** 주면 **오른쪽에도** 패널이 선다(Query 의 Schema, Collection 의 저장 쿼리 등). */
  rightPanel?: ReactNode
  rightTitle?: string
  rightActions?: ReactNode
  rightDefaultSize?: number
}

/**
 * 워크스페이스 내부의 리사이즈 가능한 [사이드바 | 메인 | (오른쪽 패널)] 분할.
 * depth 와 무관하게 개별 워크스페이스가 자체적으로 사용한다.
 *
 * `collapsible` 이면 양쪽 패널을 각각 접을 수 있고, 양쪽을 한 번에 여닫는 손잡이가 더 선다.
 * 그 **양쪽 손잡이는 네 자리 모두**(양쪽 머리줄·양쪽 띠)에 같은 모양으로 둔다 — 한 곳에만 두면
 * 그 패널이 접힌 순간 손잡이도 같이 사라져 되돌릴 방법이 없어진다.
 */
export function WorkspacePanels({
  sidebar,
  sidebarTitle,
  sidebarActions,
  children,
  defaultSize = 22,
  autoSaveId,
  collapsible = false,
  rightPanel,
  rightTitle,
  rightActions,
  rightDefaultSize = 22
}: WorkspacePanelsProps) {
  const leftRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  // 접힘은 `onCollapse` 가 아니라 폭으로 판정한다 — autoSaveId 로 접힌 채 복원된 첫 렌더에서는
  // `onCollapse` 가 안 울려, 띠도 패널도 없는 "펼칠 방법이 사라진" 상태가 된다.
  const onLeftResize = (size: number): void => setLeftCollapsed(collapsible && size === 0)
  const onRightResize = (size: number): void => setRightCollapsed(collapsible && size === 0)

  const hasRight = !!rightPanel
  /** 양쪽 손잡이는 오른쪽 패널이 있을 때만 뜻이 있다 — 없으면 "양쪽"이 곧 왼쪽 하나다. */
  const bothToggle = collapsible && hasRight
  const allCollapsed = leftCollapsed && rightCollapsed

  const toggleBoth = useCallback(() => {
    if (allCollapsed) {
      leftRef.current?.expand()
      rightRef.current?.expand()
    } else {
      leftRef.current?.collapse()
      rightRef.current?.collapse()
    }
  }, [allCollapsed])

  const bothButton = bothToggle ? (
    <PanelButton
      hook="data-panels-both"
      label={allCollapsed ? '양쪽 패널 펼치기' : '양쪽 패널 접기'}
      onClick={toggleBoth}
      icon={allCollapsed ? <ChevronsRightLeft className="size-4" /> : <ChevronsLeftRight className="size-4" />}
    />
  ) : null

  return (
    <div className="flex h-full min-h-0">
      {leftCollapsed && (
        <Rail
          side="left"
          title={sidebarTitle}
          onExpand={() => leftRef.current?.expand()}
          extra={bothButton}
        />
      )}

      <PanelGroup direction="horizontal" className="min-w-0 flex-1" autoSaveId={autoSaveId}>
        {/*
          `id`·`order` 는 오른쪽 패널이 **있다 없다 하기 때문에** 필요하다(2026-08-12) — 이름표가
          없으면 부품이 패널을 순서로만 알아봐서, 개수가 변한 뒤 저장해 둔 폭이 엉뚱한 패널에 붙는다.
        */}
        <Panel
          id="left"
          order={1}
          ref={leftRef}
          // 접혔는지를 검사가 **실제 폭**으로 재게 하는 훅 — 접힌 패널은 폭 0 으로 눌릴 뿐
          // 안의 행은 잘려 있을 뿐이라, 행이 보이는지로는 접힘을 가릴 수 없다(실측).
          data-workspace-sidebar
          defaultSize={defaultSize}
          minSize={14}
          maxSize={42}
          collapsible={collapsible}
          collapsedSize={0}
          onResize={onLeftResize}
          // 접히면 폭 0 으로 눌릴 뿐 DOM 에는 남는다(검색어·고른 탭이 유지되도록) — 그래서
          // 안 보이는 채로 Tab 에 걸린다. `inert` 로 초점·읽어주기 대상에서 뺀다.
          inert={leftCollapsed}
          className="flex flex-col overflow-hidden bg-panel"
        >
          <PanelHeader
            title={sidebarTitle}
            actions={
              <>
                {sidebarActions}
                {bothButton}
                {collapsible && (
                  <PanelButton
                    hook="data-sidebar-collapse"
                    label={sidebarTitle ? `${sidebarTitle} 접기` : '사이드바 접기'}
                    onClick={() => leftRef.current?.collapse()}
                    icon={<PanelLeftClose className="size-4" />}
                  />
                )}
              </>
            }
            show={!!(sidebarTitle || sidebarActions || collapsible)}
          />
          <div className="min-h-0 flex-1 overflow-auto">{sidebar}</div>
        </Panel>

        <Handle hidden={leftCollapsed} />

        <Panel id="center" order={2} className="min-w-0 bg-canvas">{children}</Panel>

        {hasRight && (
          <>
            <Handle hidden={rightCollapsed} />
            <Panel
              id="right"
              order={3}
              ref={rightRef}
              data-workspace-right
              defaultSize={rightDefaultSize}
              minSize={14}
              maxSize={42}
              collapsible={collapsible}
              collapsedSize={0}
              onResize={onRightResize}
              inert={rightCollapsed}
              className="flex flex-col overflow-hidden bg-panel"
            >
              <PanelHeader
                title={rightTitle}
                actions={
                  <>
                    {rightActions}
                    {bothButton}
                    {collapsible && (
                      <PanelButton
                        hook="data-right-collapse"
                        label={rightTitle ? `${rightTitle} 접기` : '오른쪽 패널 접기'}
                        onClick={() => rightRef.current?.collapse()}
                        icon={<PanelRightClose className="size-4" />}
                      />
                    )}
                  </>
                }
                show={!!(rightTitle || rightActions || collapsible)}
              />
              <div className="min-h-0 flex-1 overflow-auto">{rightPanel}</div>
            </Panel>
          </>
        )}
      </PanelGroup>

      {rightCollapsed && (
        <Rail
          side="right"
          title={rightTitle}
          onExpand={() => rightRef.current?.expand()}
          extra={bothButton}
        />
      )}
    </div>
  )
}

/** 접힌 패널 자리에 남는 좁은 세로 띠 — 누르면 펼쳐진다. */
function Rail({
  side,
  title,
  onExpand,
  extra
}: {
  side: 'left' | 'right'
  title?: string
  onExpand: () => void
  extra?: ReactNode
}) {
  const Icon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  return (
    <div
      className={cx(
        'flex w-9 shrink-0 flex-col items-center gap-1 bg-panel pt-2',
        side === 'left' ? 'border-r border-line' : 'border-l border-line'
      )}
    >
      <PanelButton
        hook={side === 'left' ? 'data-sidebar-expand' : 'data-right-expand'}
        label={title ? `${title} 펼치기` : '패널 펼치기'}
        onClick={onExpand}
        icon={<Icon className="size-4" />}
      />
      {extra}
      {title && (
        <span className="mt-1 [writing-mode:vertical-rl] text-[11px] font-semibold tracking-wide text-muted">
          {title}
        </span>
      )}
    </div>
  )
}

function PanelHeader({
  title,
  actions,
  show
}: {
  title?: string
  actions: ReactNode
  show: boolean
}) {
  if (!show) return null
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
      {title && (
        <span className="truncate text-[12px] font-semibold tracking-wide text-muted">{title}</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  )
}

/** 머리줄·띠에 공통으로 서는 작은 아이콘 손잡이 — 같은 일을 하는 버튼은 같은 모양이어야 한다. */
function PanelButton({
  hook,
  label,
  onClick,
  icon
}: {
  hook: string
  label: string
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      {...{ [hook]: '' }}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted outline-none transition-colors hover:bg-panel-strong hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      {icon}
    </button>
  )
}

function Handle({ hidden }: { hidden: boolean }) {
  return (
    <PanelResizeHandle
      className={cx(
        'w-px bg-line transition-colors',
        // 접힌 동안은 손잡이가 세로 띠와 겹쳐 보인다 — 펼치기는 띠가 맡는다.
        hidden && 'hidden',
        // Tab 으로 닿는 요소인데 표시가 없으면 키보드 사용자는 지금 어디인지 모른다
        // (WCAG 2.4.7). 마우스 hover 와 같은 강조를 포커스에도 준다.
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent data-[resize-handle-state=drag]:bg-accent'
      )}
    />
  )
}
