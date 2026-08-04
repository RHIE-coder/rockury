import { Minus, Square, X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { sourceLabel } from '@shared/sourceLabel'
import { ProjectSelector } from './ProjectSelector'

const dragRegion: CSSProperties = { WebkitAppRegion: 'drag' }
const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' }

/** 빌드 시점에 주입되는 소스 루트 경로 (electron.vite.config.ts). */
declare const __SOURCE_ROOT__: string

/**
 * 개발 중에만 보이는 소스 폴더 배지 — 병렬 개발에서 **지금 보는 창이 어느 워크트리 앱인지**
 * 화면만으로 구분하기 위한 것. 앱은 한 번에 하나만 뜨므로, 남이 띄워 둔 창을 자기 것으로
 * 착각하는 사고가 실제로 난다(그 창엔 내 변경이 없다).
 * 배포본(import.meta.env.PROD)에서는 렌더되지 않는다.
 */
function SourceBadge() {
  if (import.meta.env.PROD) return null
  const label = sourceLabel(__SOURCE_ROOT__)
  return (
    <span
      data-source-label={label}
      title="개발 중인 소스 폴더 — 이 창은 이 폴더의 코드입니다"
      className="ml-2 rounded border border-line bg-panel px-1.5 py-px font-mono text-[10px] leading-[14px] text-muted"
    >
      {label}
    </span>
  )
}

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
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="text-[15px] leading-none text-accent">
          ◆
        </span>
        <span className="text-[13px] font-semibold tracking-tight">Rockury</span>
        <span className="ml-1 hidden text-[11px] font-medium text-muted min-[1100px]:inline">
          Build on Rock, Speed like Mercury
        </span>
        <SourceBadge />

        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line" />
        {/* 창 드래그 영역 안이라 조작 요소는 no-drag 로 빼 준다(안 그러면 클릭이 창 끌기로 먹힌다). */}
        <span style={noDrag} className="min-w-0">
          <ProjectSelector />
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
