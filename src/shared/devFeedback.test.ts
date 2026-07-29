import { describe, expect, it } from 'vitest'
import {
  BADGE_RADIUS,
  FEEDBACK_CHANNEL_MISSING,
  MAX_LOGS,
  appendCapped,
  badgeCenter,
  badgeHit,
  feedbackFailureMessage,
  feedbackFolderName,
  formatClock,
  formatStamp,
  isNoiseComponentName,
  markLabel,
  parseFeedbackPayload,
  probePoints,
  renderNoteMarkdown,
  slugifyRoute,
  type FeedbackPayload
} from './devFeedback'

/**
 * 개발용 화면 피드백의 순수 로직 회귀 테스트.
 * 여기서 지키는 선은 두 가지다 — ⑴ 저장이 조용히 덮이거나 폴더 밖으로 새지 않는다,
 * ⑵ note.md 만 읽어도 "어디의 무엇이 왜 불만인지"를 알 수 있다.
 */

function payload(over: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    location: { route: '/db/studio/schema', label: 'DB › Studio › Schema', context: [] },
    viewport: { width: 1440, height: 900 },
    marks: [{ memo: '여백이 좁다', bounds: { x: 10, y: 20, width: 30, height: 40 }, target: null }],
    logs: [],
    ...over
  }
}

describe('표시 번호와 배지', () => {
  it('스무 개까지는 동그라미 숫자, 넘으면 괄호 숫자로 떨어진다', () => {
    expect(markLabel(0)).toBe('①')
    expect(markLabel(19)).toBe('⑳')
    expect(markLabel(20)).toBe('(21)')
  })

  it('배지는 표시 영역의 좌상단 모서리에 얹힌다', () => {
    expect(badgeCenter({ x: 100, y: 50, width: 80, height: 40 })).toEqual({
      x: 100 + BADGE_RADIUS,
      y: 50 + BADGE_RADIUS
    })
  })

  it('배지를 누르면 그 표시가 잡히고, 멀리 누르면 아무것도 안 잡힌다', () => {
    const marks = [{ id: 7, bounds: { x: 0, y: 0, width: 50, height: 50 } }]
    expect(badgeHit(marks, BADGE_RADIUS, BADGE_RADIUS)).toBe(7)
    expect(badgeHit(marks, 300, 300)).toBeNull()
  })

  it('배지가 겹치면 나중에 그린 것이 이긴다 — 화면에서 위에 보이는 것과 같아야 한다', () => {
    const marks = [
      { id: 1, bounds: { x: 0, y: 0, width: 50, height: 50 } },
      { id: 2, bounds: { x: 2, y: 2, width: 50, height: 50 } }
    ]
    expect(badgeHit(marks, BADGE_RADIUS + 1, BADGE_RADIUS + 1)).toBe(2)
  })
})

describe('요소 찾기 보조', () => {
  it('가운데를 가장 먼저 찔러 본다 — 둘러싸게 그리는 것이 자연스러운 동작이라', () => {
    const [first] = probePoints({ x: 0, y: 0, width: 100, height: 200 })
    expect(first).toEqual([50, 100])
  })

  it('가운데가 빈 자리일 때를 대비해 안쪽 네 점을 더 준다', () => {
    expect(probePoints({ x: 0, y: 0, width: 100, height: 100 })).toHaveLength(5)
  })

  it('배선용 껍데기 컴포넌트 이름은 사슬에서 걸러낸다', () => {
    expect(isNoiseComponentName('NavProvider')).toBe(true)
    expect(isNoiseComponentName('ErrorBoundary')).toBe(true)
    expect(isNoiseComponentName('Fragment')).toBe(true)
    // 소문자로 시작하면 컴포넌트가 아니라 DOM 태그다.
    expect(isNoiseComponentName('div')).toBe(true)
    expect(isNoiseComponentName('SchemaCanvas')).toBe(false)
  })
})

describe('콘솔 기록 버퍼', () => {
  it('상한을 넘으면 오래된 것부터 버린다', () => {
    let list: number[] = []
    for (let i = 0; i < 5; i += 1) list = appendCapped(list, i, 3)
    expect(list).toEqual([2, 3, 4])
  })
})

describe('저장 폴더 이름', () => {
  it('경로 구분자와 특수문자를 없애 폴더 밖으로 새지 않게 한다', () => {
    expect(slugifyRoute('/db/studio/schema')).toBe('db-studio-schema')
    expect(slugifyRoute('/../../etc/passwd')).toBe('etc-passwd')
    expect(slugifyRoute('///')).toBe('root')
  })

  it('초까지 넣어, 같은 화면에서 연달아 남긴 피드백이 서로를 덮지 않는다', () => {
    const a = feedbackFolderName(new Date(2026, 6, 29, 15, 30, 12), '/db/studio/schema')
    const b = feedbackFolderName(new Date(2026, 6, 29, 15, 30, 13), '/db/studio/schema')
    expect(a).toBe('20260729-153012-db-studio-schema')
    expect(a).not.toBe(b)
  })

  it('사람이 읽는 시각은 로컬 시계를 따른다', () => {
    expect(formatStamp(new Date(2026, 6, 29, 9, 5, 3))).toBe('2026-07-29 09:05:03')
    expect(formatClock(new Date(2026, 6, 29, 9, 5, 3))).toBe('09:05:03')
  })
})

describe('보낸 내용 검증', () => {
  it('제대로 된 내용은 통과한다', () => {
    const res = parseFeedbackPayload(payload())
    expect(res.ok).toBe(true)
  })

  it('화면 위치가 없거나 nav 경로 꼴이 아니면 거절한다', () => {
    expect(parseFeedbackPayload({ ...payload(), location: undefined })).toEqual({
      ok: false,
      error: '화면 위치(location)가 없습니다'
    })
    expect(
      parseFeedbackPayload({ ...payload(), location: { route: 'db/studio', label: '', context: [] } }).ok
    ).toBe(false)
  })

  it('표시가 하나도 없으면 거절한다 — 빈 피드백은 저장할 값이 없다', () => {
    expect(parseFeedbackPayload({ ...payload(), marks: [] })).toEqual({
      ok: false,
      error: '표시가 하나도 없습니다'
    })
  })

  it('표시가 스무 개를 넘으면 거절한다', () => {
    const one = payload().marks[0]
    expect(parseFeedbackPayload({ ...payload(), marks: Array.from({ length: 21 }, () => one) }).ok).toBe(
      false
    )
  })

  it('표시 영역에 숫자가 아닌 값이 섞이면 거절한다', () => {
    expect(
      parseFeedbackPayload({ ...payload(), marks: [{ memo: '', bounds: { x: 'a', y: 0, width: 1, height: 1 } }] })
        .ok
    ).toBe(false)
  })

  it('콘솔 로그는 상한까지만 남기고, 모르는 level 은 error 로 본다', () => {
    const logs = Array.from({ length: MAX_LOGS + 5 }, (_, i) => ({ level: 'nope', at: '00:00:00', text: `L${i}` }))
    const res = parseFeedbackPayload({ ...payload(), logs })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.logs).toHaveLength(MAX_LOGS)
    expect(res.value.logs[0]).toEqual({ level: 'error', at: '00:00:00', text: 'L5' })
  })

  it('요소 정보가 깨져 있어도 표시 자체는 살린다 — 좌표만으로도 쓸모가 있다', () => {
    const res = parseFeedbackPayload({
      ...payload(),
      marks: [{ memo: 'x', bounds: { x: 0, y: 0, width: 1, height: 1 }, target: { tag: 'div' } }]
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.marks[0].target).toBeNull()
  })
})

describe('저장 실패 안내', () => {
  // 회귀 — 실패했는데 화면에 아무 말도 안 나오면 "보내기가 안 먹는다"로 보인다(2026-07-29 실측).
  it('통로가 없을 때는 앱을 다시 띄우라고 말한다 — "저장 실패"만으로는 다시 그리게 만든다', () => {
    expect(feedbackFailureMessage(new Error("No handler registered for 'shell:saveDevFeedback'"))).toBe(
      FEEDBACK_CHANNEL_MISSING
    )
    expect(feedbackFailureMessage(new TypeError('window.rockury.devFeedback.save is not a function'))).toBe(
      FEEDBACK_CHANNEL_MISSING
    )
  })

  it('그 밖의 실패는 원문을 보여 주고, 표시가 남아 있다는 것을 알린다', () => {
    const msg = feedbackFailureMessage(new Error('EACCES: permission denied'))
    expect(msg).toContain('EACCES: permission denied')
    expect(msg).toContain('다시 보내')
  })

  it('Error 가 아닌 것이 던져져도 문자열로 만든다', () => {
    expect(feedbackFailureMessage('그냥 문자열')).toContain('그냥 문자열')
  })
})

describe('note.md', () => {
  const at = new Date(2026, 6, 29, 15, 30, 12)

  it('메모·좌표·컴포넌트·컨텍스트를 한 파일에서 다 읽을 수 있다', () => {
    const md = renderNoteMarkdown(
      payload({
        location: {
          route: '/db/studio/schema',
          label: 'DB › Studio › Schema',
          context: [{ label: 'Design', value: '주문 도메인' }]
        },
        marks: [
          {
            memo: '버튼이 잘린다',
            bounds: { x: 10.4, y: 20.6, width: 30, height: 40 },
            target: {
              tag: 'button',
              className: 'rounded px-2',
              testId: 'save-btn',
              text: '저장',
              cssPath: 'div > button',
              components: ['SaveButton', 'SchemaToolbar'],
              rect: { x: 10, y: 20, width: 30, height: 40 }
            }
          }
        ]
      }),
      { at, imageFile: 'shot.png', sourceRoot: '/Users/me/rockury' }
    )
    expect(md).toContain('# 화면 피드백 · DB › Studio › Schema')
    expect(md).toContain('- 남긴 시각: 2026-07-29 15:30:12')
    expect(md).toContain('- Design: 주문 도메인')
    expect(md).toContain('- 소스 폴더: `/Users/me/rockury`')
    expect(md).toContain('## ① 버튼이 잘린다')
    expect(md).toContain('- 컴포넌트: SaveButton ‹ SchemaToolbar')
    expect(md).toContain('- 테스트 아이디: `save-btn`')
    // 소수점 좌표는 반올림해 보여 준다 — 읽는 사람에게 0.4px 은 의미가 없다.
    expect(md).toContain('x=10 y=21')
  })

  it('캡처가 실패했으면 "이미지 없음"을 분명히 적는다 — 조용히 빠지면 없는 그림을 찾게 된다', () => {
    const md = renderNoteMarkdown(payload(), { at, imageFile: null })
    expect(md).toContain('화면 이미지: 없음')
  })

  it('메모를 안 적었으면 그렇다고 적는다', () => {
    const md = renderNoteMarkdown(
      payload({ marks: [{ memo: '   ', bounds: { x: 0, y: 0, width: 1, height: 1 }, target: null }] }),
      { at, imageFile: null }
    )
    expect(md).toContain('## ① (메모 없음)')
  })

  it('콘솔 오류가 있으면 뒤에 붙는다', () => {
    const md = renderNoteMarkdown(
      payload({ logs: [{ level: 'error', at: '15:30:01', text: 'boom\nat foo' }] }),
      { at, imageFile: null }
    )
    expect(md).toContain('## 콘솔 (피드백 직전까지)')
    expect(md).toContain('`15:30:01` **error** boom ⏎ at foo')
  })

  it('콘솔이 조용했으면 그 절은 아예 없다', () => {
    expect(renderNoteMarkdown(payload(), { at, imageFile: null })).not.toContain('## 콘솔')
  })
})
