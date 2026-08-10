import { markLabel } from '@shared/devFeedback'
import { BTN, PANEL } from './styles'
import { MARK_COLOR, type DraftMark, type DraftStep } from './types'

/**
 * 흐름 고치기 — 지나온 화면들의 **차례**를 바꾸고, 잘못 들른 화면을 뺀다.
 *
 * 왜 필요한가: 그린 순서가 곧 흐름이지만, 늘 이야기 순서대로 돌아다니지는 않는다.
 * "B를 보고 나서 A가 문제인 걸 알았지만 설명은 A부터"가 실제로 흔하다. 에이전트는 이
 * 순서를 그대로 흐름으로 읽으므로, 순서가 틀리면 원인과 결과가 뒤집혀 전달된다.
 *
 * 화면 단위로만 바꾼다. 자국 하나하나의 순서는 뜻이 없고(같은 화면 안에서는 다 같이
 * 보인다), 화면 차례만이 "무엇을 하고 나서 무엇이 됐나"를 가른다.
 *
 * 앱의 공용 UI 부품과 디자인 토큰을 일부러 안 쓴다 — 이 도구가 필요한 순간은 그것들이
 * 깨져 있을 때다(styles.ts 참고).
 */

interface Props {
  steps: DraftStep[]
  marks: DraftMark[]
  /** 아직 안 굳힌, 지금 그리고 있는 화면. 목록 맨 끝에 흐리게 붙는다. */
  current: { label: string; screen: number }
  /** 타이틀바 높이만큼 내려 시작한다 — 창 제어 위에 얹히면 안 된다. */
  topInset: number
  onMove: (index: number, delta: number) => void
  onRemove: (index: number) => void
  onClose: () => void
}

const CHIP: React.CSSProperties = {
  ...PANEL,
  boxShadow: 'none',
  borderRadius: 999,
  padding: '4px 10px',
  font: '400 11px/1.5 system-ui, sans-serif'
}

const ROW_MAIN: React.CSSProperties = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '400 12px/1.5 system-ui, sans-serif'
}

const ROW_SUB: React.CSSProperties = {
  display: 'block',
  color: '#94a3b8',
  font: '400 11px/1.5 system-ui, sans-serif'
}

/** 이 화면에 표시를 남긴 묶음들의 배지 번호. 화면을 뺄 때 무엇이 같이 사라지는지 미리 보인다. */
function labelsOnScreen(marks: DraftMark[], screen: number): string[] {
  return marks
    .map((m, i) => (m.parts.some((p) => p.screen === screen) ? markLabel(i) : null))
    .filter((label): label is string => label !== null)
}

export function FlowModal({
  steps,
  marks,
  current,
  topInset,
  onMove,
  onRemove,
  onClose
}: Props): React.JSX.Element {
  const onCurrent = labelsOnScreen(marks, current.screen)
  return (
    // 화면 위 그리기를 통째로 덮는다 — 순서를 고치는 동안 뒤에 그려지면 안 된다.
    <div
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: topInset + 8,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(15,23,42,0.45)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...CHIP, fontWeight: 600, color: '#0f172a' }}>흐름</span>
        <span style={{ ...CHIP, color: '#475569' }}>
          이 순서가 그대로 이야기가 됩니다 (무엇을 하고 나서 무엇이 됐나)
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          style={{ ...BTN, ...PANEL, borderRadius: 999, fontWeight: 600 }}
        >
          닫기
        </button>
      </div>

      <div
        style={{
          ...PANEL,
          minHeight: 0,
          flex: 1,
          overflowY: 'auto',
          borderRadius: 12,
          padding: 6
        }}
      >
        {steps.map((step, i) => {
          const on = labelsOnScreen(marks, step.seq)
          return (
            <div
              key={step.seq}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 8,
                padding: '8px 6px'
              }}
            >
              <span
                style={{
                  width: 42,
                  flexShrink: 0,
                  color: '#0f172a',
                  font: '600 12px/1.5 system-ui, sans-serif'
                }}
              >
                {i + 1}단계
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ ...ROW_MAIN, color: '#0f172a' }}>{step.location.label}</span>
                <span style={ROW_SUB}>
                  {on.length > 0 ? `표시 ${on.join(' ')}` : '표시 없음'}
                  {step.hasImage ? '' : ' · 그림 없음'}
                </span>
              </span>
              <button
                type="button"
                aria-label="위로"
                style={{ ...BTN, opacity: i === 0 ? 0.3 : 1 }}
                disabled={i === 0}
                onClick={() => onMove(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="아래로"
                style={{ ...BTN, opacity: i === steps.length - 1 ? 0.3 : 1 }}
                disabled={i === steps.length - 1}
                onClick={() => onMove(i, 1)}
              >
                ↓
              </button>
              {/* 잘못 들른 화면을 빼는 길. 그 화면의 표시도 같이 사라지므로 개수를 먼저 보였다. */}
              <button
                type="button"
                style={on.length > 0 ? { ...BTN, color: MARK_COLOR } : BTN}
                onClick={() => onRemove(i)}
              >
                빼기
              </button>
            </div>
          )
        })}

        {/* 지금 보고 있는 화면. 아직 안 굳혔으니 옮기거나 뺄 수 없다 — 그래도 목록에
            보여야 한다. 안 보이면 "방금 그린 화면은 어디 갔지"가 된다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px' }}>
          <span
            style={{
              width: 42,
              flexShrink: 0,
              color: '#94a3b8',
              font: '600 12px/1.5 system-ui, sans-serif'
            }}
          >
            {steps.length + 1}단계
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ ...ROW_MAIN, color: '#94a3b8' }}>{current.label}</span>
            <span style={ROW_SUB}>
              지금 화면 (보내거나 다음으로 넘길 때 굳습니다)
              {onCurrent.length > 0 ? ` · 표시 ${onCurrent.join(' ')}` : ''}
            </span>
          </span>
        </div>

        {steps.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: '0 6px 6px',
              color: '#94a3b8',
              font: '400 11px/1.5 system-ui, sans-serif'
            }}
          >
            화면을 굳히면 여기서 차례를 바꿀 수 있습니다.
          </p>
        ) : null}
      </div>
    </div>
  )
}
