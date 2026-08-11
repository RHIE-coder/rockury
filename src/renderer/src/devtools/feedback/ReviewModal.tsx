import { BTN, PANEL, SCROLL_ATTR } from './styles'
import type { ReviewRow, ReviewScreen } from './review'
import { MARK_COLOR, SKETCH_BADGE_COLOR } from './types'

/**
 * 훑어보기 — **쌓은 것을 한 자리에서 보고 그 자리서 고친다.**
 *
 * 왜 하나로 합쳤나: 예전엔 보는 곳(목록)과 화면을 다루는 곳(흐름)이 갈려 있었고, 어느
 * 쪽에서도 **지난 화면의 항목은 못 만졌다.** 메모창이 자국 옆에 붙는 구조라 지난 화면
 * 항목에는 붙을 자리가 없었고, 그래서 하나를 빼려면 화면을 통째로 빼고 — 남의 표시까지
 * 잃고 — 처음부터 다시 그려야 했다(2026-08-11 사용자 제보).
 *
 * 화면(단계)이 뼈대고 그 아래 그 화면의 항목이 달린다. 화면을 걸친 항목은 걸친 화면마다
 * 한 줄씩 서고, 그 줄에서 **그 화면 몫만** 뺄 수 있다.
 *
 * 앱의 공용 UI 부품과 디자인 토큰을 일부러 안 쓴다 — 이 도구가 필요한 순간은 그것들이
 * 깨져 있을 때다(styles.ts 참고).
 */

interface Props {
  screens: ReviewScreen[]
  /** 화면 신원(`seq`) → 썸네일 데이터 URL. 아직 안 읽었으면 칸이 없고, 못 읽었으면 null. */
  shots: Record<number, string | null>
  /** 타이틀바 높이만큼 내려 시작한다 — 창 제어 위에 얹히면 안 된다. */
  topInset: number
  /**
   * 알림 한 줄. **여기서 그려야 한다** — 도구막대 아래 안내 자리는 이 패널에 가려서,
   * 화면을 뺄 때 "딸린 표시도 같이 사라졌습니다"가 조용히 묻혔다.
   */
  notice: string | null
  /** 나중에 묶기 — 고르는 중인 묶음 id 들. null 이면 고르는 중이 아니다. */
  mergeIds: number[] | null
  /** 남긴 항목 수. 둘 이상일 때만 묶기가 뜻이 있다. */
  markCount: number
  onMove: (index: number, delta: number) => void
  onRemoveScreen: (index: number) => void
  onMemo: (id: number, memo: string) => void
  onSketch: (id: number) => void
  onRemoveMark: (id: number) => void
  onRemovePartsOnScreen: (id: number, screen: number) => void
  /** 이 항목에 이어 그린다 — 고르고 패널을 접는다. */
  onResume: (id: number) => void
  onStartMerge: () => void
  onCancelMerge: () => void
  onToggleMerge: (id: number) => void
  onApplyMerge: () => void
  onClose: () => void
}

const CHIP: React.CSSProperties = {
  ...PANEL,
  boxShadow: 'none',
  borderRadius: 999,
  padding: '4px 10px',
  font: '400 11px/1.5 system-ui, sans-serif'
}

/** 줄 안의 작은 손잡이. 한 줄에 넷까지 서므로 기본 버튼보다 좁게 잡는다. */
const ROW_BTN: React.CSSProperties = {
  ...BTN,
  padding: '3px 7px',
  font: '500 11px/1.4 system-ui, sans-serif'
}

const META: React.CSSProperties = {
  color: '#94a3b8',
  font: '400 10px/1.6 system-ui, sans-serif'
}

const THUMB_WIDTH = 160
/**
 * 메모칸 폭 상한. 창 폭을 다 먹게 두면 손잡이가 저 멀리 오른쪽 끝에 떨어져, 고칠 항목과
 * 그것을 고치는 버튼 사이를 눈이 매번 가로질러야 한다.
 */
const MEMO_WIDTH = 620
/** 패널 폭 상한 — 썸네일 + 메모칸 + 손잡이가 딱 들어갈 만큼. 한 열로 읽히게 묶는다. */
const COLUMN = THUMB_WIDTH + MEMO_WIDTH + 302

/** 썸네일 자리. 그림이 없어도 자리를 비워 둔다 — 줄이 화면마다 어긋나면 훑기가 안 된다. */
function Shot({
  url,
  hasImage,
  current
}: {
  url: string | null | undefined
  hasImage: boolean
  current: boolean
}): React.JSX.Element {
  const frame: React.CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: THUMB_WIDTH,
    minHeight: 68,
    overflow: 'hidden',
    borderRadius: 8,
    border: current ? '1px dashed rgba(15,23,42,0.22)' : '1px solid rgba(15,23,42,0.14)',
    background: 'rgba(15,23,42,0.03)',
    color: '#94a3b8',
    font: '400 10px/1.5 system-ui, sans-serif'
  }
  if (url) {
    return (
      <span style={frame}>
        <img src={url} alt="" style={{ display: 'block', width: '100%' }} />
      </span>
    )
  }
  // 아직 안 읽어 온 동안(url === undefined)은 아무 말도 안 쓴다 — 곧 그림이 들어올 자리에
  // "없음"을 띄우면 매번 깜빡이며 거짓을 말한다.
  return <span style={frame}>{current ? '지금 보는 화면' : hasImage ? '' : '그림 없음'}</span>
}

/** 항목 한 줄 — 보기와 고치기가 같은 줄에 있다. */
function Row({
  row,
  screen,
  onMemo,
  onSketch,
  onRemoveMark,
  onRemovePartsOnScreen,
  onResume
}: {
  row: ReviewRow
  screen: number
} & Pick<
  Props,
  'onMemo' | 'onSketch' | 'onRemoveMark' | 'onRemovePartsOnScreen' | 'onResume'
>): React.JSX.Element {
  const meta = [
    row.parts > 1 ? `표시 ${row.parts}개` : null,
    row.screens > 1 ? `화면 ${row.screens}개` : null
  ].filter((s): s is string => s !== null)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}>
      <span
        style={{ paddingTop: 4, color: MARK_COLOR, font: '600 13px/1.4 system-ui, sans-serif' }}
      >
        {row.label}
      </span>
      <span style={{ minWidth: 0, flex: '1 1 auto', maxWidth: MEMO_WIDTH }}>
        {/* 메모는 **곧바로 고칠 수 있는 칸**이다. 눌러서 편집 모드로 들어가는 단계를 두지
            않는다 — 이 패널에 오는 이유의 절반이 "저 문장을 고치겠다"이기 때문이다. */}
        <input
          value={row.memo}
          placeholder="무엇이 문제인가요?"
          aria-label={`${row.label} 메모`}
          onChange={(e) => onMemo(row.id, e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = MARK_COLOR)}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(15,23,42,0.10)')}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            borderRadius: 6,
            border: '1px solid rgba(15,23,42,0.10)',
            background: '#fff',
            padding: '5px 7px',
            font: '400 13px/1.4 system-ui, sans-serif',
            color: '#0f172a',
            outline: 'none'
          }}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <span style={META}>{row.where}</span>
          {meta.length > 0 ? <span style={META}>· {meta.join(' · ')}</span> : null}
        </span>
      </span>
      {/* 손잡이는 메모칸 바로 옆이다 — 고칠 것과 고치는 버튼이 멀면 눈이 매번 가로지른다. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button type="button" style={ROW_BTN} onClick={() => onResume(row.id)}>
          이어 그리기
        </button>
        <button
          type="button"
          style={row.hasSketch ? { ...ROW_BTN, color: SKETCH_BADGE_COLOR } : ROW_BTN}
          onClick={() => onSketch(row.id)}
        >
          {row.hasSketch ? '그림 고치기' : '그림 그리기'}
        </button>
        {/* 걸친 항목만 갈래가 둘이다 — 이 화면 몫만 뺄지, 통째로 지울지. */}
        {row.screens > 1 ? (
          <button
            type="button"
            style={ROW_BTN}
            onClick={() => onRemovePartsOnScreen(row.id, screen)}
          >
            이 화면 표시만 빼기
          </button>
        ) : null}
        <button
          type="button"
          style={{ ...ROW_BTN, color: MARK_COLOR }}
          onClick={() => onRemoveMark(row.id)}
        >
          지우기
        </button>
      </span>
    </div>
  )
}

export function ReviewModal({
  screens,
  shots,
  topInset,
  notice,
  mergeIds,
  markCount,
  onMove,
  onRemoveScreen,
  onMemo,
  onSketch,
  onRemoveMark,
  onRemovePartsOnScreen,
  onResume,
  onStartMerge,
  onCancelMerge,
  onToggleMerge,
  onApplyMerge,
  onClose
}: Props): React.JSX.Element {
  const frozen = screens.filter((s) => !s.current).length

  return (
    // 화면 위 그리기를 통째로 덮는다 — 훑어보는 동안 뒤에 그려지면 안 된다.
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
      {/* 머리도 목록과 같은 폭에 묶는다 — 닫기가 창 끝에 혼자 떠 있으면 딴 화면처럼 보인다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: COLUMN }}>
        <span style={{ ...CHIP, fontWeight: 600, color: '#0f172a' }}>훑어보기</span>
        {/* 순서가 곧 이야기라는 것은 코드를 봐야 아는 계약이라 한 줄로 남긴다. 대신 한 번만
            말한다 — 예전 흐름 모달은 같은 말을 괄호로 한 번 더 되풀이했다. */}
        <span style={{ ...CHIP, color: '#475569' }}>화면 순서가 그대로 이야기가 됩니다</span>
        {notice ? (
          <span style={{ ...CHIP, color: MARK_COLOR, fontWeight: 500 }}>{notice}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {mergeIds ? (
          <>
            <span style={{ ...CHIP, color: '#475569' }}>
              한 이야기인 것을 둘 이상 고르세요 (메모 하나를 같이 씁니다)
            </span>
            <button type="button" style={{ ...BTN, ...PANEL, borderRadius: 999 }} onClick={onCancelMerge}>
              취소
            </button>
            <button
              type="button"
              disabled={mergeIds.length < 2}
              onClick={onApplyMerge}
              style={{
                ...BTN,
                ...PANEL,
                borderRadius: 999,
                color: MARK_COLOR,
                fontWeight: 600,
                opacity: mergeIds.length < 2 ? 0.4 : 1
              }}
            >
              {mergeIds.length >= 2 ? `${mergeIds.length}개 묶기` : '묶기'}
            </button>
          </>
        ) : markCount > 1 ? (
          <button type="button" style={{ ...BTN, ...PANEL, borderRadius: 999 }} onClick={onStartMerge}>
            따로 남긴 것 묶기
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          style={{ ...BTN, ...PANEL, borderRadius: 999, fontWeight: 600 }}
        >
          닫기
        </button>
      </div>

      <div
        // 오버레이는 휠을 삼키지만(화면 얼리기) 이 칸 안에서는 살려 둔다. 끝에 닿았을 때
        // 뒤 화면으로 넘어가지 않게 스크롤 사슬도 여기서 끊는다.
        {...{ [SCROLL_ATTR]: '' }}
        style={{
          ...PANEL,
          minHeight: 0,
          // 판은 **내용만큼만** 크다(넘치면 줄어들며 스크롤). 늘려 두면 항목 셋짜리 제보에도
          // 판이 창을 통째로 덮어, 아래 절반이 이유 없이 비어 보인다.
          flex: '0 1 auto',
          maxWidth: COLUMN,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          borderRadius: 12,
          padding: 6
        }}
      >
        {screens.map((s) => (
          <div
            key={s.seq}
            style={{
              borderTop: s.step === 1 ? undefined : '1px solid rgba(15,23,42,0.08)',
              padding: '8px 6px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 42,
                  flexShrink: 0,
                  color: s.current ? '#94a3b8' : '#0f172a',
                  font: '600 12px/1.5 system-ui, sans-serif'
                }}
              >
                {s.step}단계
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: s.current ? '#94a3b8' : '#0f172a',
                    font: '400 12px/1.5 system-ui, sans-serif'
                  }}
                >
                  {s.label}
                </span>
                {s.current ? (
                  <span style={META}>보내거나 다음으로 넘길 때 굳습니다</span>
                ) : null}
              </span>
              {/* 지금 화면은 아직 안 굳혔으니 옮기거나 뺄 수 없다. */}
              {s.current ? null : (
                <>
                  <button
                    type="button"
                    aria-label="위로"
                    style={{ ...ROW_BTN, opacity: s.step === 1 ? 0.3 : 1 }}
                    disabled={s.step === 1}
                    onClick={() => onMove(s.step - 1, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="아래로"
                    style={{ ...ROW_BTN, opacity: s.step === frozen ? 0.3 : 1 }}
                    disabled={s.step === frozen}
                    onClick={() => onMove(s.step - 1, 1)}
                  >
                    ↓
                  </button>
                  {/* 잘못 들른 화면을 빼는 길. 이 화면의 항목이 같이 사라지므로 아래 목록이
                      곧 그 예고다 — 개수를 따로 적지 않는다. */}
                  <button
                    type="button"
                    style={s.rows.length > 0 ? { ...ROW_BTN, color: MARK_COLOR } : ROW_BTN}
                    onClick={() => onRemoveScreen(s.step - 1)}
                  >
                    화면 빼기
                  </button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <Shot url={shots[s.seq]} hasImage={s.hasImage} current={s.current} />
              <div style={{ minWidth: 0, flex: 1 }}>
                {s.rows.length === 0 ? (
                  <p style={{ margin: '4px 0 0', ...META }}>표시 없음</p>
                ) : (
                  s.rows.map((row) =>
                    mergeIds ? (
                      // 고르는 중에는 줄 전체가 고르는 버튼이다 — 그 자리에서 메모를 고치는
                      // 칸과 겹치면 어느 쪽이 지금 하는 일인지 알 수 없다.
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => onToggleMerge(row.id)}
                        style={{
                          display: 'flex',
                          width: '100%',
                          alignItems: 'center',
                          gap: 8,
                          background: 'transparent',
                          border: 0,
                          borderRadius: 8,
                          padding: '6px 4px',
                          textAlign: 'left',
                          cursor: 'pointer'
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            color: mergeIds.includes(row.id) ? MARK_COLOR : '#94a3b8',
                            font: '400 12px/1.4 system-ui, sans-serif'
                          }}
                        >
                          {mergeIds.includes(row.id) ? '◉' : '○'}
                        </span>
                        <span style={{ color: MARK_COLOR, font: '600 12px/1.4 system-ui, sans-serif' }}>
                          {row.label}
                        </span>
                        <span
                          style={{
                            minWidth: 0,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            font: '400 12px/1.4 system-ui, sans-serif'
                          }}
                        >
                          {row.memo.trim() || '(메모 없음)'}
                        </span>
                        <span style={META}>{row.where}</span>
                      </button>
                    ) : (
                      <Row
                        key={row.id}
                        row={row}
                        screen={s.seq}
                        onMemo={onMemo}
                        onSketch={onSketch}
                        onRemoveMark={onRemoveMark}
                        onRemovePartsOnScreen={onRemovePartsOnScreen}
                        onResume={onResume}
                      />
                    )
                  )
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
