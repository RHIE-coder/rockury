import { Fragment } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { ChevronDown } from 'lucide-react'
import { useActive, useNav } from '../nav/useNav'
import type { ContextSelector, ModuleArea, Service } from '../nav/types'
import { cx } from '../lib/cx'
import { HintChip, SelectorMenu, useSelector } from './contextSelector'

/**
 * 구획 그룹 뱃지. 각 구획이 **시작하는 자리**에 렌더된다. common 은 뱃지 없이 구분선만.
 * 설계=Mercury 시안, 운영=테라코타 — globals.css 팔레트로 두 부서에 색 정체성 부여.
 */
const AREA_CHIP: Partial<Record<ModuleArea, { label: string; cls: string }>> = {
  design: { label: '설계', cls: 'bg-accent-soft text-accent' },
  ops: { label: '운영', cls: 'bg-accent-2-soft text-accent-2' }
}

/**
 * L2 — 서비스 내부 모듈 탭 (상단 1차, 활성 = 진한 시안 pill). 구획이 바뀌는 자리에 구분선.
 *
 * 구획 뱃지는 **자기 구획의 대상을 든다** — 서비스가 `context` 셀렉터에 `area` 를 달아 두면
 * 그 뱃지가 손잡이로 자라 설계·시점·연결을 여기서 고른다(2026-07-30 사용자 결정).
 * 그래서 이 한 줄이 "무엇을 대상으로, 어디로 이동하는가"를 함께 말한다. 대상과 이동이
 * 위아래 두 줄로 갈려 있던 동안은 "저 위의 것이 아래 어느 묶음에 걸리는지"를 사람이 외워야 했다.
 *
 * 이동(탭)과 선택(손잡이)이 한 줄에 서므로 **모양으로 갈라 둔다** — 탭은 배경 없는 글자
 * (활성만 진한 시안 채움), 손잡이는 테두리 + 드롭다운 화살표. 구획 색은 앞머리 라벨에만
 * 남긴다: 손잡이를 통째로 연한 시안으로 채우면 활성 탭의 진한 시안과 같은 계열이 한 줄에 둘이 된다.
 */
export function ModuleTabs() {
  const { service, module } = useActive()
  const selectModule = useNav((s) => s.selectModule)

  return (
    <Tabs.Root value={module.id} onValueChange={selectModule} className="shrink-0">
      <Tabs.List
        aria-label="모듈"
        className="flex items-center gap-1 overflow-x-auto border-b border-line bg-canvas px-3 py-2"
      >
        {service.modules.map((m, i) => {
          const Icon = m.icon
          const area: ModuleArea = m.area ?? 'common'
          const prevArea: ModuleArea | null = i > 0 ? service.modules[i - 1].area ?? 'common' : null
          // 뱃지는 "구획이 시작하는 자리"마다 — 전환 지점에만 그리면 **첫 구획이 뱃지를 잃는다**
          // (DB 에서 Overview 를 뺀 순간 설계 뱃지가 조용히 사라졌다).
          const groupStart = prevArea === null || area !== prevArea
          const chip = AREA_CHIP[area]

          return (
            <Fragment key={m.id}>
              {groupStart && (
                <span className="flex shrink-0 items-center gap-2 pl-1 pr-0.5">
                  {prevArea !== null && <span aria-hidden className="h-4 w-px bg-line" />}
                  {chip && <AreaHandle service={service} area={area} chip={chip} />}
                </span>
              )}
              <Tabs.Trigger
                value={m.id}
                // surface-verify 자동 순회 훅(전 모듈 캡처) — 지우면 UI 게이트가 화면을 잃는다.
                data-nav-module={m.id}
                className={cx(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  'text-muted hover:bg-panel-strong hover:text-fg',
                  'data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:hover:bg-accent'
                )}
              >
                <Icon size={16} />
                {m.label}
              </Tabs.Trigger>
            </Fragment>
          )
        })}
      </Tabs.List>
    </Tabs.Root>
  )
}

/**
 * 구획 뱃지 + 그 구획에 붙은 셀렉터들. 셀렉터가 없는 서비스는 예전처럼 라벨 알약만 남는다.
 * 여러 셀렉터가 같은 구획을 쓰면 한 테두리 안에서 세로선으로 나뉜다 — 따로 선 칩 여럿이 아니라
 * "이 구획의 대상" 한 덩어리로 읽혀야 소속이 눈에 보인다.
 */
function AreaHandle({
  service,
  area,
  chip
}: {
  service: Service
  area: ModuleArea
  chip: { label: string; cls: string }
}) {
  const pill = (
    <span
      className={cx(
        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
        chip.cls
      )}
    >
      {chip.label}
    </span>
  )

  const selectors = service.context?.filter((s) => s.area === area) ?? []
  if (!selectors.length) return pill

  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-canvas py-1 pl-1.5 pr-1.5">
      {pill}
      {selectors.map((sel, i) => (
        // 칸막이를 따로 세우지 않고 **칸 자신의 왼쪽 테두리**로 그린다 — 서비스가 직접 그리는 칸
        // (`Render`)은 조건에 따라 아무것도 안 그릴 수 있어서(설계 미선택 시의 시점 렌즈),
        // 칸막이를 별도 요소로 두면 뒤가 빈 채 선만 덩그러니 남는다. `empty:hidden` 이 그 경우
        // 칸째로 접어 선까지 같이 사라지게 한다.
        <span
          key={sel.id}
          className={cx(
            'flex min-w-0 items-center empty:hidden',
            i > 0 && 'ml-0.5 border-l border-line pl-2'
          )}
        >
          {sel.Render ? <sel.Render /> : <HandleSelector sel={sel} />}
        </span>
      ))}
    </span>
  )
}

/** 손잡이 안의 셀렉터 한 칸 — 컨텍스트 바 칩과 달리 라벨(‘Design’)은 앞머리 뱃지가 대신한다. */
function HandleSelector({ sel }: { sel: ContextSelector }) {
  const state = useSelector(sel)
  const { current } = state

  return (
    <SelectorMenu
      sel={sel}
      state={state}
      trigger={
        <button
          type="button"
          // e2e·화면 게이트가 셀렉터를 라벨 문자열이 아니라 역할로 집게 하는 훅 — 지우면 순회가 깨진다.
          data-context-selector={sel.id}
          title={current ? `${sel.label} — ${current.label}` : sel.placeholder}
          className={cx(
            'flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] transition-colors',
            'hover:bg-panel-strong data-[state=open]:bg-panel-strong'
          )}
        >
          {current ? (
            <>
              {/* 좁아지면 이름부터 조인다 — 탭 글자를 잃는 것보다 이름이 줄어드는 편이 낫다. */}
              <span className="max-w-[180px] truncate font-medium text-fg max-[1599px]:max-w-[140px]">
                {current.label}
              </span>
              <HintChip hint={current.hint} dot={current.dot} compact />
            </>
          ) : (
            <span className="italic text-muted">{sel.placeholder ?? 'Select…'}</span>
          )}
          <ChevronDown size={13} className="shrink-0 text-muted" />
        </button>
      }
    />
  )
}
