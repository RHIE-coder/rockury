import { describe, expect, it } from 'vitest'
import { reviewScreens } from './review'
import type { DraftMark, DraftStep, MarkPart } from './types'
import type { FeedbackTarget } from '@shared/devFeedback'

/**
 * 훑어보기 목록 회귀 테스트.
 * 지키는 선은 하나다 — **남긴 것이 목록에서 빠지지 않는다.** 한 줄이 안 서면 사용자는
 * 없는 줄 알고 다시 그리는데, 그게 이 기능을 만든 이유 그 자체다.
 */

function target(name: string): FeedbackTarget {
  return {
    tag: 'div',
    className: '',
    testId: null,
    text: '',
    cssPath: '',
    components: [name],
    rect: { x: 0, y: 0, width: 10, height: 10 }
  }
}

function part(over: Partial<MarkPart> = {}): MarkPart {
  return {
    kind: 'shape',
    shape: null,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    target: null,
    screen: 1,
    ...over
  }
}

function mark(over: Partial<DraftMark> = {}): DraftMark {
  return { id: 1, parts: [part()], memo: '', sketch: null, ...over }
}

function step(seq: number): DraftStep {
  return {
    seq,
    location: { route: `/s${seq}`, label: `화면 ${seq}`, context: [] },
    viewport: { width: 1440, height: 900 },
    hasImage: true
  }
}

const current = { seq: 3, label: '지금 화면' }

describe('훑어보기 목록', () => {
  it('굳힌 화면들 뒤에 지금 화면이 늘 붙는다 — 안 보이면 방금 그린 것이 어디 갔는지 모른다', () => {
    const screens = reviewScreens([step(1), step(2)], [], current)
    expect(screens.map((s) => s.step)).toEqual([1, 2, 3])
    expect(screens.map((s) => s.current)).toEqual([false, false, true])
    expect(screens[2].label).toBe('지금 화면')
  })

  it('굳힌 화면이 없어도 지금 화면 한 줄은 선다', () => {
    const screens = reviewScreens([], [mark({ parts: [part({ screen: 3 })] })], current)
    expect(screens).toHaveLength(1)
    expect(screens[0].rows).toHaveLength(1)
  })

  it('배지 번호는 묶음 전체 목록에서 몇 번째인가다 — 화면별로 다시 세면 화면 배지와 어긋난다', () => {
    const marks = [
      mark({ id: 1, parts: [part({ screen: 1 })] }),
      mark({ id: 2, parts: [part({ screen: 2 })] }),
      mark({ id: 3, parts: [part({ screen: 2 })] })
    ]
    const screens = reviewScreens([step(1), step(2)], marks, current)
    expect(screens[0].rows.map((r) => r.label)).toEqual(['①'])
    expect(screens[1].rows.map((r) => r.label)).toEqual(['②', '③'])
  })

  it('화면을 걸친 묶음은 걸친 화면마다 한 줄씩 선다 — 한 번만 세우면 나머지 화면에서 사라진 것처럼 보인다', () => {
    const marks = [mark({ id: 1, parts: [part({ screen: 1 }), part({ screen: 2 })] })]
    const screens = reviewScreens([step(1), step(2)], marks, current)
    expect(screens[0].rows.map((r) => r.id)).toEqual([1])
    expect(screens[1].rows.map((r) => r.id)).toEqual([1])
    // 걸쳤다는 사실이 줄마다 보여야 "이 화면 몫만 빼기"가 붙을 수 있다.
    expect(screens[0].rows[0].screens).toBe(2)
    expect(screens[0].rows[0].partsHere).toBe(1)
    expect(screens[0].rows[0].parts).toBe(2)
  })

  it('표시가 없는 화면은 줄이 없다 — 잘못 들른 화면을 빼는 판단 근거다', () => {
    const screens = reviewScreens([step(1), step(2)], [mark({ parts: [part({ screen: 1 })] })], current)
    expect(screens[1].rows).toEqual([])
  })

  it('가리킨 요소는 그 화면의 첫 표시에서 뽑는다 — 지난 화면 것을 보이면 엉뚱한 파일로 간다', () => {
    const marks = [
      mark({
        id: 1,
        parts: [
          part({ screen: 1, target: target('PlanView') }),
          part({ screen: 2, target: target('CompareView') })
        ]
      })
    ]
    const screens = reviewScreens([step(1), step(2)], marks, current)
    expect(screens[0].rows[0].where).toBe('PlanView')
    expect(screens[1].rows[0].where).toBe('CompareView')
  })

  it('요소를 못 찾은 표시는 "빈 자리"로 선다 — 빈칸으로 두면 줄이 무엇인지 알 수 없다', () => {
    const screens = reviewScreens([step(1)], [mark({ parts: [part({ screen: 1 })] })], current)
    expect(screens[0].rows[0].where).toBe('빈 자리')
  })

  it('메모·그림 유무를 그대로 실어 준다 — 목록이 곧 "각 메세지"다', () => {
    const marks = [mark({ id: 1, memo: '정렬이 깨짐', sketch: 'data:image/png;base64,x' })]
    const rows = reviewScreens([step(1)], marks, current)[0].rows
    expect(rows[0].memo).toBe('정렬이 깨짐')
    expect(rows[0].hasSketch).toBe(true)
  })

  it('화면 차례는 배열 자리를 따르고 신원(seq)은 그대로다 — 순서를 바꿔도 표시가 안 밀린다', () => {
    const screens = reviewScreens([step(2), step(1)], [], current)
    expect(screens.map((s) => [s.step, s.seq])).toEqual([
      [1, 2],
      [2, 1],
      [3, 3]
    ])
  })
})
