/**
 * 도구막대 아래 안내 한 줄에 **무엇을 띄울지** 정한다.
 *
 * 왜 갈라 뒀나: 그 한 자리를 넷이 나눠 쓰는데, 그중 하나가 **오류**다. 순서를 잘못 두면
 * "화면을 저장하지 못했습니다"가 안내에 가려 조용히 묻힌다 — 그리고 그 손해는 저장이
 * 실패한 바로 그 순간에만 드러난다. 화면에 묶여 있으면 순서를 테스트로 못 박을 수가 없다.
 *
 * 갈래를 **상태에서 뽑는 것**도 여기 있는 이유다. "지금 ①이 듣고 있다"는 사건이 아니라
 * 상태라, 훑어보기에서 "이어 그리기"를 눌렀을 때 한 번 띄우는 식이면 같은 상태에 들어오는
 * 다른 길(지우개로 이 화면 자국만 지우기)을 놓친다.
 */

export type FeedbackHintKind = 'notice' | 'resume' | 'flow' | 'basic'

export interface FeedbackHint {
  text: string
  kind: FeedbackHintKind
}

export interface FeedbackHintInput {
  /** 사건 알림 — 묶음 알림과 오류가 같이 쓴다. 스스로 물러나므로 무엇보다 앞에 둔다. */
  notice: string | null
  /** 고른 묶음의 배지 번호(`markLabel` 이 낸 것). 고른 것이 없으면 null. */
  pickedLabel: string | null
  /** 고른 묶음이 **지금 화면에도** 자국을 갖고 있나. */
  pickedHasPartHere: boolean
  /** 이미 굳힌 화면 수. */
  steps: number
  /** 남긴 묶음 수. */
  marks: number
}

export function feedbackHint(i: FeedbackHintInput): FeedbackHint | null {
  // 오류가 뜨는 동안은 오류가 이긴다. 물러나면 아래 갈래로 알아서 되돌아온다.
  if (i.notice) return { text: i.notice, kind: 'notice' }

  // 고른 묶음은 있는데 지금 화면에 그 자국이 없다 = 메모창이 붙을 데가 없다.
  // 이때 아무 말도 안 하면 "① 이 듣고 있다"는 유일한 표시가 사라져, 이어 그리려는
  // 사람이 자기가 무엇에 붙이고 있는지 알 길이 없다.
  if (i.pickedLabel !== null && !i.pickedHasPartHere) {
    return { text: `여기서 그리면 ${i.pickedLabel} 에 이어 붙습니다`, kind: 'resume' }
  }

  // 지금 그리는 것이 몇 번째 화면인지 모르면 "다음 화면"을 누른 것이 먹혔는지조차 알 수 없다.
  if (i.steps > 0) {
    return {
      text: `${i.steps + 1}번째 화면 · 앞 화면 ${i.steps}개는 그림으로 남았습니다`,
      kind: 'flow'
    }
  }

  // 몸짓이 모드를 가르므로, 처음 여는 사람이 배워야 할 것은 이 한 줄이 전부다.
  // 한 번이라도 남겼으면 배운 것이라 치우고 자리를 비운다(도구가 앉은 자리는 못 그린다).
  if (i.marks === 0) return { text: '콕 누르면 핀 · 끌면 그리기', kind: 'basic' }

  return null
}
