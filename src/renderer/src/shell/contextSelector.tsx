import type { ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { useNav } from '../nav/useNav'
import { useContextOptions } from '../nav/contextOptions'
import type { ContextOption, ContextSelector } from '../nav/types'

/**
 * 컨텍스트 셀렉터의 공용 알맹이 — 옵션 읽기와 드롭다운.
 *
 * 셀렉터가 놓이는 자리가 둘(컨텍스트 바 · 뷰 탭 줄의 구획 손잡이)이라, 얼굴만 다르고
 * 목록·선택·액션은 같다. 그 같은 부분을 여기 한 곳에 두고 두 자리가 함께 쓴다 —
 * 갈라 두면 한쪽에만 고친 동작이 다른 쪽에서 조용히 어긋난다.
 */

/**
 * 옵션 hint 렌더 — dot(벤더 컬러)이 있으면 "점 + 라벨" 배지 문구로, 없으면 흐린 텍스트로.
 * `compact` 는 좁은 창에서 글자를 접고 점만 남긴다(폭을 벌어야 하는 손잡이 전용).
 */
export function HintChip({
  hint,
  dot,
  compact = false
}: {
  hint?: string
  dot?: string
  compact?: boolean
}) {
  if (!hint) return null
  if (!dot) return <span className="shrink-0 text-[11px] text-muted">{hint}</span>
  return (
    <span
      title={compact ? hint : undefined}
      className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-medium text-fg"
    >
      <span className="size-1.5 rounded-full" style={{ background: dot }} />
      {compact ? <span className="max-[1599px]:hidden">{hint}</span> : hint}
    </span>
  )
}

export interface SelectorState {
  options: ContextOption[]
  current: ContextOption | null
  select: (optionId: string) => void
}

/** 셀렉터의 지금 상태 — 런타임 옵션이 등록돼 있으면 정적 옵션을 대체한다. */
export function useSelector(sel: ContextSelector): SelectorState {
  const values = useNav((s) => s.contextValues)
  const setValue = useNav((s) => s.setContextValue)
  const runtimeOptions = useContextOptions((s) => s.options)

  const options = runtimeOptions[sel.id] ?? sel.options
  // 초기 contextValues 는 비어 있으므로 defaultOptionId 는 읽기 시점에 폴백한다.
  const selectedId = values[sel.id] ?? sel.defaultOptionId
  const current = options.find((o) => o.id === selectedId) ?? null

  return { options, current, select: (optionId) => setValue(sel.id, optionId) }
}

/** 셀렉터 드롭다운 — `trigger` 가 얼굴, 목록·액션은 어디서 열든 같다. */
export function SelectorMenu({
  sel,
  state,
  trigger
}: {
  sel: ContextSelector
  state: SelectorState
  trigger: ReactNode
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          // 폭 상한이 없으면 항목 안의 `truncate` 가 영영 안 걸린다 — 메뉴가 내용만큼 늘어나
          // 자를 일이 없어지기 때문. 라벨·부제는 남이 써 넣는 글(가져온 명세·에이전트 작성)이라
          // 길이를 믿을 수 없다. 화면에 남은 폭(Radix 가 재 준 값)과 420px 중 작은 쪽으로 묶는다.
          className="z-50 min-w-[180px] max-w-[min(420px,var(--radix-dropdown-menu-content-available-width))] rounded-lg border border-line bg-canvas p-1 shadow-lg"
        >
          {state.options.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] italic text-muted">아직 항목이 없어요</div>
          )}
          {state.options.map((o) => {
            const selected = o.id === state.current?.id
            return (
              <DropdownMenu.Item
                key={o.id}
                onSelect={() => state.select(o.id)}
                className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selected ? (
                    <Check size={14} className="shrink-0 text-accent" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    {/* 잘린 글은 마우스를 올리면 전문이 뜬다 — 자르기만 하면 읽을 길이 사라진다. */}
                    <span className="truncate" title={o.label}>
                      {o.label}
                    </span>
                    {o.subtitle && (
                      <span className="truncate text-[11px] font-normal text-muted" title={o.subtitle}>
                        {o.subtitle}
                      </span>
                    )}
                  </span>
                </span>
                <HintChip hint={o.hint} dot={o.dot} />
              </DropdownMenu.Item>
            )
          })}
          {sel.actions?.length ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              {sel.actions.map((a) => {
                const ActionIcon = a.icon
                return (
                  <DropdownMenu.Item
                    key={a.id}
                    // Radix 이슈: 메뉴 아이템에서 곧바로 Dialog 를 열면 메뉴 닫힘과 모달 스크롤락이
                    // 겹쳐 body 의 pointer-events:none 이 복원되지 않아 UI 전체가 클릭 불능이 된다.
                    // 메뉴가 완전히 닫힌 뒤 실행한다.
                    onSelect={() => setTimeout(a.onSelect, 0)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-accent outline-none data-[highlighted]:bg-accent-soft"
                  >
                    {ActionIcon ? <ActionIcon size={14} /> : <span className="w-3.5" />}
                    {a.label}
                  </DropdownMenu.Item>
                )
              })}
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
