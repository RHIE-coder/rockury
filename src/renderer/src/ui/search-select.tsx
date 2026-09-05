import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useOutsideClose } from '@renderer/lib/useOutsideClose'
import { filterOptions, moveCursor, type SearchOption } from './searchSelect'

/**
 * 검색 카드(§db-remote.data.filter AC-1/AC-1a/AC-1b) — 검색창이 위에 달린 선택 목록.
 *
 * 왜 `ui/select.tsx`(Radix Select)나 브라우저 기본 `<select>` 가 아닌가: 둘 다 후보를
 * 타이핑으로 좁힐 수 없다. 컬럼이 수십 개인 표에서 필터 컬럼을 고르려면 목록을 눈으로
 * 훑어 내려가야 했다(2026-08-07 사용자 지적). 거르기·정렬·커서 규칙은 `searchSelect.ts`.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = '고르기',
  searchPlaceholder = '검색',
  className,
  triggerClassName,
  mono,
  disabled,
  title,
  hook
}: {
  value: string
  options: readonly SearchOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  triggerClassName?: string
  /** 컬럼명처럼 고정폭이 읽기 쉬운 값에 쓴다. */
  mono?: boolean
  disabled?: boolean
  title?: string
  /** e2e 가 이 카드를 집는 이름(`data-search-select`) — 구조·클래스로 집으면 손댈 때마다 깨진다. */
  hook?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const boxRef = useOutsideClose<HTMLDivElement>(open, () => setOpen(false))
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => filterOptions(options, query), [options, query])
  const current = options.find((o) => o.value === value)

  // 열린 채로 부모가 다시 그려져도 아래 "열 때 초기화"가 다시 돌면 안 된다 — 옵션 배열은
  // 부모가 매번 새로 만들기 때문에 그걸 의존성에 두면 **사용자가 치던 검색어가 지워진다.**
  // 그래서 값은 ref 로만 읽고, 효과는 여닫힘에만 매단다.
  const latest = useRef({ options, value })
  latest.current = { options, value }

  // 열 때마다 검색어를 비우고 지금 고른 항목에 커서를 둔다 — 지난번 검색어가 남아 있으면
  // 카드를 다시 열었을 때 목록 대부분이 사라진 채로 보인다.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const { options: opts, value: v } = latest.current
    const at = opts.findIndex((o) => o.value === v)
    setCursor(at >= 0 ? at : 0)
    searchRef.current?.focus()
  }, [open])

  // 검색어가 바뀌면 커서를 맨 위로 — 효과가 아니라 **입력 처리 안에서** 옮긴다.
  // 효과로 두면 카드를 열 때도 같이 돌아, 위에서 고른 항목에 맞춰 둔 커서를 0 으로 덮는다.
  const onQuery = (next: string): void => {
    setQuery(next)
    setCursor(filterOptions(options, next).length ? 0 : -1)
  }

  // 키보드로 옮긴 항목이 스크롤 밖이면 따라 내려간다 — 안 그러면 커서가 안 보이는 채로 움직인다.
  useEffect(() => {
    if (!open || cursor < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const pick = (v: string): void => {
    onChange(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => moveCursor(c, e.key === 'ArrowDown' ? 1 : -1, shown.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = shown[cursor]
      if (hit) pick(hit.value)
      return
    }
    // Esc 는 useOutsideClose 가 문서 단계에서 이미 닫는다 — 여기서 또 처리하면 두 번 닫힌다.
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        data-search-select={hook}
        disabled={disabled}
        title={title ?? current?.label ?? placeholder}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] outline-none',
          'hover:bg-panel focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          mono && 'font-mono',
          triggerClassName
        )}
      >
        <span className={cn('min-w-0 truncate', !current && 'text-muted')}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted" />
      </button>

      {/* 떠 있는 것은 `z-50` — 이 집의 팝오버·메뉴·툴팁·대화상자가 전부 그 층이다.
          z-30 이었을 때 Data 표의 얼어붙은 `#` 머리칸(같은 z-30)이 이 카드를 덮었다:
          같은 층이면 DOM 뒤에 오는 표가 이긴다(2026-09-04 제보).

          폭은 **내용에 맡긴다**(`w-max`). 고정 `w-56` 은 한쪽엔 좁고 한쪽엔 넓었다 —
          컬럼 카드에선 `bigint(20) unsigned` 같은 타입 라벨이 자리를 먹어 이름이
          `variant_…` 로 잘렸고(고르는 기준이 이름인데 둘이 똑같이 보였다), 연산자
          카드에선 `= 같다` 한 줄에 224px 이 남아돌았다. 손잡이보다 좁아지지 않게
          `min-w-full`, 이름이 아주 긴 표에서 화면을 밀지 않게 `max-w-96`. */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-max min-w-full max-w-96 overflow-hidden rounded-md border border-line bg-canvas shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-auto p-1">
            {shown.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-muted">맞는 항목 없음</div>
            ) : (
              shown.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px]',
                    i === cursor && 'bg-accent-soft text-accent'
                  )}
                >
                  <Check className={cn('size-3 shrink-0', o.value !== value && 'invisible')} />
                  <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono text-[11px]')}>{o.label}</span>
                  {/* 이름이 먼저다 — 좁아지면 타입 라벨이 줄어 이름 자리를 남긴다.
                      `shrink-0` 이던 시절엔 반대로 이름이 먼저 잘렸다. */}
                  {o.hint && (
                    <span className="min-w-0 max-w-[45%] shrink truncate font-mono text-[10px] text-muted">
                      {o.hint}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export type { SearchOption }
