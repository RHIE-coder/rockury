import { PALETTE, WIDTHS, type Tool } from './types'
import { PANEL } from './styles'

/**
 * 그리기 도구막대 — 화면 위 오버레이와 스케치판이 같이 쓴다.
 *
 * 라벨을 글자로 달지 않고 그림으로 두는 이유는 폭이다 — "화살표" 세 글자짜리 버튼 다섯이면
 * 도구막대가 창을 가로로 크게 먹고, 그만큼 피드백을 못 남기는 자리가 넓어진다.
 * 대신 `aria-label`·`title` 로 이름을 남겨, 눈으로도 손으로도 무엇인지 알 수 있게 한다.
 */

const TOOLS: Array<{ tool: Tool; label: string; icon: React.ReactNode }> = [
  { tool: 'pen', label: '펜', icon: <path d="M3 13c3-1 4-8 7-8s2 7 5 7 3-4 3-4" /> },
  { tool: 'line', label: '직선', icon: <path d="M4 16 16 4" /> },
  {
    tool: 'arrow',
    label: '화살표',
    icon: (
      <>
        <path d="M4 16 16 4" />
        <path d="M9 4h7v7" />
      </>
    )
  },
  { tool: 'box', label: '상자', icon: <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" /> },
  {
    tool: 'eraser',
    label: '지우개',
    icon: (
      <>
        <path d="M9 15h7" />
        <path d="m4.5 12.5 5-5a1.5 1.5 0 0 1 2.2 0l2.8 2.8a1.5 1.5 0 0 1 0 2.2l-2.5 2.5H7.5z" />
      </>
    )
  }
]

const ICON_BTN: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  height: 28,
  width: 28,
  background: 'transparent',
  border: 0,
  borderRadius: 8,
  padding: 0,
  color: '#334155',
  cursor: 'pointer'
}

const DIVIDER: React.CSSProperties = {
  height: 16,
  width: 1,
  margin: '0 2px',
  background: 'rgba(15,23,42,0.16)'
}

export function ToolStrip({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth
}: {
  tool: Tool
  onTool: (t: Tool) => void
  color: string
  onColor: (c: string) => void
  width: number
  onWidth: (w: number) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        ...PANEL,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        borderRadius: 999,
        padding: '4px 6px',
        pointerEvents: 'auto'
      }}
    >
      {TOOLS.map((t) => {
        const on = tool === t.tool
        return (
          <button
            key={t.tool}
            type="button"
            aria-label={t.label}
            aria-pressed={on}
            title={t.label}
            onClick={() => onTool(t.tool)}
            // 켜진 도구는 지금 고른 색으로 물든다 — 도구와 색을 한 눈에 같이 읽는다.
            style={on ? { ...ICON_BTN, background: color, color: '#fff' } : ICON_BTN}
          >
            <svg
              viewBox="0 0 20 20"
              width={17}
              height={17}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {t.icon}
            </svg>
          </button>
        )
      })}

      <span aria-hidden style={DIVIDER} />

      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`색 ${c}`}
          aria-pressed={color === c}
          onClick={() => {
            onColor(c)
            // 색을 고르는 건 "그리겠다"는 뜻이다. 지우개에 머물러 있으면 아무 일도 안 일어난다.
            if (tool === 'eraser') onTool('pen')
          }}
          style={{ ...ICON_BTN, height: 24, width: 24, borderRadius: 999, color: c }}
        >
          <span
            style={{
              display: 'block',
              borderRadius: 999,
              background: c,
              width: color === c ? 16 : 12,
              height: color === c ? 16 : 12,
              boxShadow:
                color === c ? '0 0 0 2px rgba(255,255,255,.9), 0 0 0 3.5px currentColor' : undefined
            }}
          />
        </button>
      ))}

      <span aria-hidden style={DIVIDER} />

      {WIDTHS.map((w) => (
        <button
          key={w}
          type="button"
          aria-label={`굵기 ${w}`}
          aria-pressed={width === w}
          onClick={() => onWidth(w)}
          style={{
            ...ICON_BTN,
            height: 24,
            width: 24,
            background: width === w ? 'rgba(15,23,42,0.07)' : 'transparent'
          }}
        >
          <span style={{ display: 'block', width: 16, borderRadius: 999, background: color, height: w }} />
        </button>
      ))}
    </div>
  )
}
