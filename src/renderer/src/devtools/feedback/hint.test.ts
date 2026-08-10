import { describe, expect, it } from 'vitest'
import { feedbackHint, type FeedbackHintInput } from './hint'

/**
 * 안내 한 줄 회귀 테스트.
 * 여기서 지키는 선은 둘이다 — ⑴ 오류가 안내에 가려 묻히지 않는다,
 * ⑵ "① 이 듣고 있다"가 **상태에서** 나온다(어느 길로 그 상태에 들어왔든 같이 잡히게).
 */

function input(over: Partial<FeedbackHintInput> = {}): FeedbackHintInput {
  return { notice: null, pickedLabel: null, pickedHasPartHere: false, steps: 0, marks: 0, ...over }
}

describe('자리 다툼 순서', () => {
  // 이 자리는 "화면을 저장하지 못했습니다" 도 쓴다. 안내가 앞에 서면 실패가 조용히 묻힌다.
  it('알림(묶음 알림·오류)이 무엇보다 먼저다', () => {
    const hint = feedbackHint(
      input({
        notice: '화면을 저장하지 못했습니다',
        pickedLabel: '①',
        pickedHasPartHere: false,
        steps: 2
      })
    )
    expect(hint).toEqual({ text: '화면을 저장하지 못했습니다', kind: 'notice' })
  })

  it('알림이 물러나면 이어 그리기 안내로 되돌아온다 — 선택은 그대로 살아 있다', () => {
    const hint = feedbackHint(
      input({ notice: null, pickedLabel: '①', pickedHasPartHere: false, steps: 2 })
    )
    expect(hint?.kind).toBe('resume')
  })

  it('이어 그리기가 "N번째 화면"보다 앞선다', () => {
    expect(feedbackHint(input({ pickedLabel: '②', pickedHasPartHere: false, steps: 3 }))?.kind).toBe(
      'resume'
    )
  })

  it('고른 것이 없으면 "N번째 화면"이 선다', () => {
    const hint = feedbackHint(input({ steps: 2, marks: 3 }))
    expect(hint).toEqual({
      text: '3번째 화면 · 앞 화면 2개는 그림으로 남았습니다',
      kind: 'flow'
    })
  })

  it('아무것도 없는 처음에만 기본 힌트가 선다', () => {
    expect(feedbackHint(input())?.kind).toBe('basic')
    // 한 번이라도 남겼으면 배운 것이라 자리를 비운다 — 도구가 앉은 자리는 못 그린다.
    expect(feedbackHint(input({ marks: 1 }))).toBeNull()
  })
})

describe('이어 그리기 안내', () => {
  it('고른 묶음의 번호를 그대로 부른다', () => {
    expect(feedbackHint(input({ pickedLabel: '③', pickedHasPartHere: false }))).toEqual({
      text: '여기서 그리면 ③ 에 이어 붙습니다',
      kind: 'resume'
    })
  })

  // 자국이 이 화면에 있으면 메모창이 그 옆에 붙는다 — 같은 말을 두 군데서 하지 않는다.
  it('지금 화면에 그 묶음의 자국이 있으면 안 뜬다', () => {
    expect(feedbackHint(input({ pickedLabel: '①', pickedHasPartHere: true, marks: 1 }))).toBeNull()
  })

  /**
   * 회귀 — 이 상태에 들어오는 길은 목록 클릭만이 아니다.
   * A·B 두 화면에 걸친 ① 에서 B 화면 자국을 지우개로 지우면, 마지막 자국이 아니라
   * 선택이 안 풀린 채 메모창만 사라진다. 목록을 안 눌렀으니 "띄우는 순간"도 없다 —
   * 상태에서 뽑기 때문에 이 길이 따로 손대지 않아도 같이 잡힌다.
   */
  it('지우개로 이 화면 자국만 지운 뒤에도 뜬다 — 목록을 안 눌렀어도', () => {
    const afterErase = feedbackHint(
      input({ pickedLabel: '①', pickedHasPartHere: false, steps: 1, marks: 1 })
    )
    expect(afterErase).toEqual({ text: '여기서 그리면 ① 에 이어 붙습니다', kind: 'resume' })
  })
})
