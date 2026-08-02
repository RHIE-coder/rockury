import { ChevronDown } from 'lucide-react'
import type { ContextSelector, ModuleArea, Service } from '../nav/types'
import { cx } from '../lib/cx'
import { HintChip, SelectorMenu, useSelector } from './contextSelector'

/**
 * 한 구획의 **대상 손잡이** — 그 구획에 붙은 셀렉터들을 한 테두리 안에 묶는다.
 * 자리는 뷰 탭 줄의 오른쪽 끝이고, 그 구획을 쓰는 모듈을 보는 동안에만 뜬다
 * (`nav/moduleSlots.handlesFor`).
 *
 * **자리 이력:** 상단 컨텍스트 바 → 모듈 탭 줄의 구획 뱃지(2026-07-30) → 뷰 탭 줄(2026-08-02).
 * 맨 위에 못박아 두었더니 지금 화면과 상관없는 대상까지 늘 떠 있었다 — 설계 화면에서 연결이,
 * 운영 화면에서 설계가. 이제 **쓰는 화면에 딸려** 뜬다.
 *
 * 여기엔 구획 뱃지('설계'·'운영')를 다시 달지 않는다 — 위 모듈 탭 줄이 이미 그 뱃지로 묶음을
 * 이름 짓고, 이 줄은 통째로 부서색 바탕(`areaAccent.strip`)을 깔고 있다. 세 번째로 또 적으면
 * 한 화면에 같은 말이 셋이다. 대신 셀렉터가 자기 아이콘으로 무엇을 고르는 자리인지 말한다.
 *
 * 여러 셀렉터가 같은 구획을 쓰면 한 테두리 안에서 세로선으로 나뉜다 — 따로 선 칩 여럿이 아니라
 * "이 구획의 대상" 한 덩어리로 읽혀야 소속이 눈에 보인다.
 */
export function AreaHandle({ service, area }: { service: Service; area: ModuleArea }) {
  const selectors = selectorsIn(service, area)
  if (!selectors.length) return null

  return (
    <span
      // e2e·화면 게이트가 "이 화면에 어느 구획 손잡이가 떴나"를 모양이 아니라 역할로 집게 하는 훅.
      data-area-handle={area}
      className="flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line bg-canvas px-1.5 py-1"
    >
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

/** 이 구획에 붙은 셀렉터들. 하나도 없으면 손잡이 자체가 없다(api·infra 가 그 경우 — 컨텍스트 바를 쓴다). */
export function selectorsIn(service: Service, area: ModuleArea): ContextSelector[] {
  return service.context?.filter((s) => s.area === area) ?? []
}

/** 손잡이 안의 셀렉터 한 칸 — 컨텍스트 바 칩과 달리 라벨('Design')은 아이콘이 대신한다. */
function HandleSelector({ sel }: { sel: ContextSelector }) {
  const state = useSelector(sel)
  const { current } = state
  const Icon = sel.icon

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
          {Icon && <Icon size={14} className="shrink-0 text-muted" />}
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
