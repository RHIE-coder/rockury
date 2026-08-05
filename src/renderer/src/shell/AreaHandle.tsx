import { ChevronDown } from 'lucide-react'
import type { ContextSelector, ModuleArea, Service } from '../nav/types'
import { cx } from '../lib/cx'
import { HintChip, SelectorMenu, useSelector } from './contextSelector'

/**
 * 부서 색 — 손잡이가 모듈 줄로 올라갔을 때(`tinted`) **테두리와 아이콘에만** 얹는다.
 *
 * 채운 카드로 안 그리는 이유(2026-08-05 사용자 결정): 그 줄은 이미 색 채운 카드로 **"여기로
 * 간다"**(설계 카드 · Migration 문 · 운영 카드)를 말하고 있다. 손잡이까지 같은 모양이면 한 줄
 * 안에서 어디를 누르면 이동이고 어디를 누르면 고르기인지가 안 갈린다. 드롭박스 모양은
 * "누르면 목록이 열린다"를 스스로 말하니 그 혼동이 안 생긴다 — 소속만 색으로 남긴다.
 */
const AREA_TINT: Record<ModuleArea, string> = {
  design: 'border-accent/40 [&_svg]:text-accent',
  ops: 'border-accent-2/40 [&_svg]:text-accent-2',
  common: 'border-line'
}

/**
 * 한 구획의 **대상 손잡이** — 그 구획에 붙은 셀렉터들을 한 덩어리로 묶는다.
 * 그 구획을 쓰는 모듈을 보는 동안에만 뜬다(`nav/moduleSlots.handlesFor`).
 * 따로 선 칩 여럿이 아니라 "이 구획의 대상" 한 덩어리로 읽혀야 소속이 눈에 보인다.
 *
 * **자리 이력:** 상단 컨텍스트 바 → 모듈 탭 줄의 구획 뱃지(2026-07-30) → 뷰 탭 줄 오른쪽 끝
 * (2026-08-02) → 모듈 줄 양옆(2026-08-05, `handleLayout: 'sides'` 인 화면만).
 *
 * **모양은 늘 한 줄이다.** 한때 두 단 카드로 접었는데(2026-08-04), 그건 "뷰 탭 줄이 가로로
 * 너무 길다"를 풀려던 것이었다. 모듈 줄로 올라가니 양옆이 통째로 비어 있어 접을 까닭이
 * 없어졌다 — 접기를 남겨 두면 이유가 사라진 장치만 남는다.
 *
 * **자리는 모듈이 정한다**(`Module.handleLayout`). 이 컴포넌트 하나가 다섯 서비스의 모든 화면을
 * 그려서, 한 화면의 요청을 여기 못박으면 나머지 전부가 따라 바뀐다 — 실제로 한 번 번뜨려서
 * 값을 밖으로 뺐다.
 *
 * 구획 뱃지('설계'·'운영')는 안 단다 — 모듈 줄이 이미 그 이름을 붙였다. 셋째로 또 적으면
 * 한 화면에 같은 말이 셋이다.
 */
export function AreaHandle({
  service,
  area,
  tinted = false
}: {
  service: Service
  area: ModuleArea
  /** 부서 색을 테두리·아이콘에 얹는다. 모듈 줄처럼 **부서색 바탕이 없는 줄**에서만 켠다. */
  tinted?: boolean
}) {
  const selectors = selectorsIn(service, area)
  if (!selectors.length) return null

  return (
    <span
      // e2e·화면 게이트가 "이 화면에 어느 구획 손잡이가 떴나"를 모양이 아니라 역할로 집게 하는 훅.
      data-area-handle={area}
      data-handle-tinted={tinted || undefined}
      className={cx(
        // `min-w-0` — 자리가 모자라면 **가운데 묶음을 미는 대신 자기가 줄어든다**(안쪽 라벨이
        // 말줄임으로 접힌다). `shrink-0` 이던 동안은 손잡이가 길어질수록 가운데 문이 밀려났다.
        // `overflow-hidden` 은 마지막 방어선이다 — 안쪽 칸 하나가 줄어들 줄 모르더라도
        // 둥근 테두리 밖으로 글자가 삐져나오지는 않는다(2026-08-05 사용자 제보: "public 글자가 툭 튀어나오네").
        'flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[9px] border bg-canvas px-1.5 py-1',
        tinted ? AREA_TINT[area] : 'border-line'
      )}
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
