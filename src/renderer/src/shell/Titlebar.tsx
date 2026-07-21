import { Minus, Square, X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

const dragRegion: CSSProperties = { WebkitAppRegion: 'drag' }
const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' }

function ControlButton({
  onClick,
  label,
  danger,
  children
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={
        'flex size-7 items-center justify-center rounded-md text-muted transition-colors ' +
        (danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-panel-strong hover:text-fg')
      }
    >
      {children}
    </button>
  )
}

/** 프레임리스 창의 커스텀 타이틀바 (드래그 영역 + 창 제어). */
export function Titlebar() {
  return (
    <header
      style={dragRegion}
      className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-canvas px-3 text-fg"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[15px] leading-none text-accent">
          ◆
        </span>
        <span className="text-[13px] font-semibold tracking-tight">Rockury</span>
        <span className="ml-1 text-[11px] font-medium text-muted">
          Build on Rock, Speed like Mercury
        </span>
      </div>

      <div style={noDrag} className="flex items-center gap-1">
        <ControlButton label="최소화" onClick={() => window.rockury.window.minimize()}>
          <Minus size={14} />
        </ControlButton>
        <ControlButton label="최대화 전환" onClick={() => window.rockury.window.toggleMaximize()}>
          <Square size={12} />
        </ControlButton>
        <ControlButton label="닫기" danger onClick={() => window.rockury.window.close()}>
          <X size={14} />
        </ControlButton>
      </div>
    </header>
  )
}
