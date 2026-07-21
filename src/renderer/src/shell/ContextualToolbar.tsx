import type { ReactNode } from 'react'

/**
 * L4 — 컨텍스트 툴바 컨테이너.
 * 활성 leaf(모듈/뷰)에 Toolbar 가 선언된 경우에만 AppShell 이 렌더한다.
 */
export function ContextualToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
      {children}
    </div>
  )
}
