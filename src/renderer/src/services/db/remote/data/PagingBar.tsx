import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { pageCount, parsePageInput } from './paging'

/**
 * 쪽 넘김 컨트롤(§db-remote.data.paging) — `처음 · 이전 · [입력]/총 · 다음 · 마지막`.
 *
 * 총 쪽수는 **모를 수 있다**(`total === null`). 셈이 아직 안 끝났으면 `…`, 실패했으면 `?`.
 * 그동안에도 처음·이전·다음은 눌린다 — 총 수를 몰라도 넘길 수는 있어야 한다. 마지막 쪽으로
 * 뛰는 것만 총 수를 알아야 해서 그때만 꺼진다(§AC-4a).
 */
export function PagingBar({
  page,
  pageSize,
  total,
  counting,
  rowsOnPage,
  loading,
  onGo
}: {
  /** 지금 쪽(0부터). */
  page: number
  pageSize: number
  /** 조건에 맞는 전체 행 수. `null` 이면 모름. */
  total: number | null
  counting: boolean
  rowsOnPage: number
  loading: boolean
  onGo: (page: number) => void
}) {
  const pages = pageCount(total, pageSize)
  const [text, setText] = useState(String(page + 1))

  // 버튼으로 옮겼을 때도 입력 칸이 따라가야 한다 — 안 그러면 칸과 표가 다른 쪽을 가리킨다.
  useEffect(() => setText(String(page + 1)), [page])

  /**
   * 보고 있는 쪽이 범위 밖이면 마지막 쪽으로 스스로 되돌아온다.
   *
   * 쪽 번호는 표마다 기억하는데 쪽 크기는 전체가 하나를 쓴다 — 표 A 에서 8쪽(25/p)을 보다
   * 다른 표에서 200/p 로 바꾸고 A 로 돌아오면, 총 2쪽뿐인데 8쪽에 서서 **빈 표에 `8 / 2`**
   * 가 뜬다. 밖에서 행이 지워져 총 쪽수가 줄었을 때도 같다. 총 쪽수를 알게 된 그 순간
   * 바로잡는다(모르는 동안은 손대지 않는다).
   */
  useEffect(() => {
    if (pages != null && page > pages - 1) onGo(pages - 1)
  }, [pages, page, onGo])

  const commit = (): void => {
    const next = parsePageInput(text, page, pages)
    setText(String(next + 1))
    if (next !== page) onGo(next)
  }

  const atFirst = page === 0
  // 총 쪽수를 알면 그것으로, 모르면 "이 쪽이 덜 찼는가"로 마지막을 짐작한다(예전 규칙 유지).
  const atLast = pages != null ? page >= pages - 1 : rowsOnPage < pageSize
  const step = (n: number): void => onGo(Math.max(0, page + n))

  return (
    <div className="flex items-center gap-0.5 text-[12px]">
      <PageButton title="처음" disabled={atFirst || loading} onClick={() => onGo(0)}>
        <ChevronsLeft className="size-4" />
      </PageButton>
      <PageButton title="이전" disabled={atFirst || loading} onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </PageButton>

      <span className="flex items-center gap-1 px-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setText(String(page + 1))
          }}
          aria-label="쪽 번호"
          className="h-6 w-12 rounded border border-line bg-canvas px-1 text-center font-mono text-[11px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <span className="text-muted">/</span>
        <span
          className={cn('min-w-8 font-mono text-[11px] tabular-nums', pages == null && 'text-muted')}
          title={pages == null ? (counting ? '전체 행 수를 세는 중' : '전체 행 수를 세지 못했습니다') : undefined}
        >
          {pages != null ? pages : counting ? '…' : '?'}
        </span>
      </span>

      <PageButton title="다음" disabled={atLast || loading} onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </PageButton>
      <PageButton
        // 마지막이 몇 쪽인지 모르면 뛸 수가 없다 — 셈이 끝나기 전엔 이것만 꺼진다.
        title={pages == null ? '전체 행 수를 아직 모릅니다' : '마지막'}
        disabled={pages == null || atLast || loading}
        onClick={() => pages != null && onGo(pages - 1)}
      >
        <ChevronsRight className="size-4" />
      </PageButton>
    </div>
  )
}

function PageButton({
  title,
  disabled,
  onClick,
  children
}: {
  title: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-muted hover:bg-panel hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
