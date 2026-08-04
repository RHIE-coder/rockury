import type { ComponentType, ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * 왼쪽 사이드 패널의 **행·구역 머리 한 벌** — DB 서비스의 모든 사이드 패널이 여기만 쓴다.
 * (Design › Definition·Diagram·Seed, Remote › Definition·Diagram·Data)
 *
 * 담는 것이 표든 시드 세트든 목록의 생김새는 같아야 한다. 예전엔 화면마다 같은 클래스 문자열을
 * 손으로 베껴 두어 한쪽만 고쳐지면 조용히 어긋났다 — 그래서 모양은 이 파일에만 적는다.
 */

/** 구역 머리 — `테이블 4` · `뷰 1` 처럼 갈래 이름과 개수. */
export function SideSectionHeader({
  icon: Icon,
  label,
  count,
  first
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  count: number
  /** 목록 맨 위면 위쪽 구분선을 그리지 않는다. */
  first?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted',
        first ? 'pt-1.5' : 'mt-1.5 border-t border-line pt-2'
      )}
    >
      <Icon className="size-3" />
      {label}
      <span className="opacity-70">{count}</span>
    </div>
  )
}

/** 목록 행 — 종류 아이콘 + 이름 + (추가 표식) + 오른쪽 끝 숫자. */
export function SideListRow({
  icon: Icon,
  name,
  count,
  active,
  onPick,
  extra,
  title,
  attrs
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  /** 오른쪽 끝 숫자(컬럼 수·행 수). */
  count: number
  active: boolean
  onPick: () => void
  /** 이름 오른쪽 표식(편집 불가 자물쇠·경고 배지 등). */
  extra?: ReactNode
  title?: string
  /** e2e 훅 등 행마다 다른 data-* 속성. */
  attrs?: Record<string, string | undefined>
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={title ?? name}
      {...attrs}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors',
        active ? 'bg-accent-soft font-semibold text-accent' : 'text-fg hover:bg-panel-strong'
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {extra}
      <span className={cn('shrink-0 text-[10.5px] tabular-nums', active ? 'text-accent/70' : 'text-muted')}>
        {count}
      </span>
    </button>
  )
}

/** 목록을 감싸는 스크롤 칸 — 좌우 여백을 화면마다 다르게 두지 않는다. */
export function SideListScroll({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">{children}</div>
}

/** 빈 상태 — 명사구 한 줄(서비스 문구 규칙: 사용법을 덧붙이지 않는다). */
export function SideListEmpty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-4 text-center text-[11.5px] italic text-muted">{children}</p>
}
