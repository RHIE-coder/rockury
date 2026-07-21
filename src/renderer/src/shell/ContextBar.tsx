import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown } from 'lucide-react'
import { useActive, useNav } from '../nav/useNav'
import { useContextOptions } from '../nav/contextOptions'
import type { ContextSelector, ModuleArea } from '../nav/types'
import { cx } from '../lib/cx'

/**
 * L1.5 — 서비스 전역 컨텍스트 바.
 *
 * 서비스가 `context` 셀렉터를 선언한 경우에만 렌더된다(예: DB 의 Design·Env).
 * nav 트리(모듈/뷰)와 별개로 "지금 어느 대상 기준으로 보는가"를 고르는 ambient 상태이며,
 * `activeInAreas` 로 특정 구획에서만 활성화된다(예: Env 는 운영부에서만).
 * 옵션이 런타임 데이터인 셀렉터는 `nav/contextOptions` 레지스트리가 정적 옵션을 대체한다.
 */
const chip =
  'flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] transition'

function isEnabled(sel: ContextSelector, area: ModuleArea): boolean {
  return !sel.activeInAreas || sel.activeInAreas.includes(area)
}

/**
 * 옵션 hint 렌더 — dot(벤더 컬러)이 있으면 "점 + 라벨" 배지 문구로,
 * 없으면 흐린 텍스트로. 벤더(방언)를 또렷한 뱃지로 통일한다.
 */
function HintChip({ hint, dot }: { hint?: string; dot?: string }) {
  if (!hint) return null
  if (!dot) return <span className="shrink-0 text-[11px] text-muted">{hint}</span>
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[10.5px] font-medium text-fg">
      <span className="size-1.5 rounded-full" style={{ background: dot }} />
      {hint}
    </span>
  )
}

export function ContextBar() {
  const { service, module } = useActive()
  const values = useNav((s) => s.contextValues)
  const setValue = useNav((s) => s.setContextValue)
  const runtimeOptions = useContextOptions((s) => s.options)

  const selectors = service.context
  if (!selectors?.length) return null

  const area: ModuleArea = module.area ?? 'common'

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
        {selectors.map((sel) => {
          const enabled = isEnabled(sel, area)
          const options = runtimeOptions[sel.id] ?? sel.options
          // 초기 contextValues 는 비어 있으므로 defaultOptionId 는 읽기 시점에 폴백한다.
          const selectedId = values[sel.id] ?? sel.defaultOptionId
          const current = options.find((o) => o.id === selectedId) ?? null
          const Icon = sel.icon

          const face = (
            <>
              {Icon && <Icon size={14} className="text-muted" />}
              <span className="text-muted">{sel.label}</span>
              {current ? (
                <>
                  <span className="font-medium text-fg">{current.label}</span>
                  <HintChip hint={current.hint} dot={current.dot} />
                </>
              ) : (
                <span className="italic text-muted">{sel.placeholder ?? 'Select…'}</span>
              )}
              <ChevronDown size={13} className="text-muted" />
            </>
          )

          if (!enabled) {
            return (
              <Tooltip.Root key={sel.id}>
                <Tooltip.Trigger asChild>
                  <div className={cx(chip, 'cursor-not-allowed opacity-40')}>{face}</div>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    sideOffset={6}
                    className="z-50 rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-white shadow-md"
                  >
                    운영부 모듈에서만 선택할 수 있어요
                    <Tooltip.Arrow className="fill-ink" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )
          }

          return (
            <DropdownMenu.Root key={sel.id}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  title={current?.subtitle || undefined}
                  className={cx(
                    chip,
                    'text-fg hover:bg-panel-strong data-[state=open]:bg-panel-strong',
                    // 값 없으면 흐리게(비활성 Env 와 동일 톤). 클릭 가능하니 hover/열림 시 진해짐.
                    !current && 'opacity-40 hover:opacity-100 data-[state=open]:opacity-100'
                  )}
                >
                  {face}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={6}
                  className="z-50 min-w-[180px] rounded-lg border border-line bg-canvas p-1 shadow-lg"
                >
                  {options.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] italic text-muted">아직 항목이 없어요</div>
                  )}
                  {options.map((o) => {
                    const selected = o.id === current?.id
                    return (
                      <DropdownMenu.Item
                        key={o.id}
                        onSelect={() => setValue(sel.id, o.id)}
                        className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-1.5 text-[13px] text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {selected ? <Check size={14} className="shrink-0 text-accent" /> : <span className="w-3.5 shrink-0" />}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{o.label}</span>
                            {o.subtitle && (
                              <span className="truncate text-[11px] font-normal text-muted">
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
                            // Radix 이슈: 메뉴 아이템에서 곧바로 Dialog 를 열면 메뉴 닫힘과
                            // 모달 스크롤락이 겹쳐 body 의 pointer-events:none 이 복원되지 않아
                            // UI 전체가 클릭 불능이 된다. 메뉴가 완전히 닫힌 뒤 실행한다.
                            onSelect={() => setTimeout(a.onSelect, 0)}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-accent outline-none data-[highlighted]:bg-accent-soft"
                          >
                            {ActionIcon ? (
                              <ActionIcon size={14} />
                            ) : (
                              <span className="w-3.5" />
                            )}
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
        })}
      </div>
    </Tooltip.Provider>
  )
}
