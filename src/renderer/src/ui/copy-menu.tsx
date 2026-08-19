import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * 우클릭 복사 메뉴 — **표의 한 줄에서 값을 꺼내 가는 유일한 손잡이.**
 *
 * 왜 우클릭인가: 줄마다 복사 아이콘을 달면 표가 시끄러워지고, 끌어서 고르는 것만으로는
 * "이름만" 처럼 조각을 정확히 집을 수 없다(2026-08-19 사용자: "각 요소별로 복사를 할 수가 없어").
 * 우클릭은 화면에 아무것도 더하지 않으면서 줄이 아는 값들을 그대로 내민다.
 *
 * 누른 뒤 **잠깐 체크 표시를 남기고** 닫는다 — 클립보드는 눈에 안 보이는 곳이라, 아무 반응이
 * 없으면 눌렸는지 알 수 없다. 이 앱엔 알림(토스트) 장치가 없어 피드백을 메뉴 안에서 끝낸다.
 */
export interface CopyItem {
  label: string
  value: string
}

/** 복사 실패는 삼킨다 — 권한·환경 문제이고, 사람이 할 수 있는 일이 없다. */
function write(text: string): void {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    // 무시
  }
}

/** 눌린 항목에 체크가 머무는 시간(ms). 눈이 알아채고 손이 떼기까지. */
const DONE_MS = 700

export function CopyMenu({
  items,
  children,
  disabled
}: {
  items: CopyItem[]
  /** 우클릭을 받을 줄. 자기 태그를 그대로 쓰도록 `asChild` 로 감싼다. */
  children: React.ReactNode
  disabled?: boolean
}) {
  const [done, setDone] = React.useState<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 체크가 남은 채로 줄이 사라지면 타이머가 죽은 컴포넌트를 건드린다.
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  if (disabled || items.length === 0) return <>{children}</>

  const pick = (item: CopyItem, e: Event): void => {
    // 기본 동작(즉시 닫기)을 막아야 체크가 보인다.
    e.preventDefault()
    write(item.value)
    setDone(item.label)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(null), DONE_MS)
  }

  return (
    <ContextMenuPrimitive.Root
      onOpenChange={(open) => {
        if (!open) setDone(null)
      }}
    >
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          data-copy-menu
          className="z-50 min-w-[9rem] overflow-hidden rounded-lg border border-line bg-canvas p-1 text-fg shadow-lg"
        >
          <ContextMenuPrimitive.Label className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            복사
          </ContextMenuPrimitive.Label>
          {items.map((item) => (
            <ContextMenuPrimitive.Item
              key={item.label}
              data-copy-item={item.label}
              onSelect={(e) => pick(item, e)}
              className={cn(
                'relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-[13px] outline-none transition-colors',
                'focus:bg-accent-soft focus:text-accent'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {done === item.label && <Check className="size-3.5 shrink-0 text-success" />}
            </ContextMenuPrimitive.Item>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
