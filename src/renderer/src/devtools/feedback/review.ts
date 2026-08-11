import { markLabel } from '@shared/devFeedback'
import { partsOnScreen, screenSpan } from './group'
import type { DraftMark, DraftStep } from './types'

/**
 * 훑어보기 목록 — **쌓은 것을 화면별로 늘어놓는다.** 화면 하나에 그 화면의 항목(묶음)들이 달린다.
 *
 * 왜 갈라 뒀나: 이 목록이 곧 "내가 무엇을 남겼나"의 전부라, 여기서 한 줄이 빠지면 사용자는
 * 없는 줄 알고 다시 그린다. 특히 **화면을 걸친 묶음은 걸친 화면마다 한 줄씩 서야 한다** —
 * 한 번만 세우면 나머지 화면에서 그 묶음이 사라진 것처럼 보이고, 정작 그 화면 몫만 빼려는
 * 손잡이가 붙을 자리가 없어진다. 화면에 묶여 있으면 그걸 테스트로 못 박을 수가 없다.
 *
 * 배지 번호는 **묶음 전체 목록에서 몇 번째인가**다(`markLabel` 의 계약). 화면별로 다시 세면
 * 화면에 그려진 배지·`note.md` 와 어긋난다.
 */

export interface ReviewRow {
  id: number
  /** 배지 번호(①). 화면 배지·`note.md` 와 같은 자를 쓴다. */
  label: string
  memo: string
  /** 이 화면에 있는 표시 수. */
  partsHere: number
  /** 묶음 전체 표시 수. */
  parts: number
  /** 이 묶음이 걸친 화면 수. 2 이상이면 다른 화면에도 이 묶음의 표시가 있다. */
  screens: number
  hasSketch: boolean
  /** 가리킨 요소 — **이 화면의 첫 표시** 기준. 못 찾았으면 '빈 자리'. */
  where: string
}

export interface ReviewScreen {
  /** 화면의 신원(`DraftStep.seq`). 표시가 붙잡고 있는 값이라 차례와 갈라 둔다. */
  seq: number
  /** 흐름 차례. 1부터. */
  step: number
  label: string
  /** 아직 안 굳힌 지금 화면인가 — 옮기거나 뺄 수 없고, 그림도 아직 없다. */
  current: boolean
  /** 굳힐 때 창을 찍었나. 지금 화면은 늘 false 다. */
  hasImage: boolean
  rows: ReviewRow[]
}

/** 목록 한 줄에 보일 "어디를 가리켰나" — 이 화면의 첫 표시를 대표로 쓴다. */
function whereOf(mark: DraftMark, screen: number): string {
  const target = partsOnScreen(mark, screen)[0]?.target
  return target?.components[0] ?? target?.tag ?? '빈 자리'
}

function rowsOnScreen(marks: readonly DraftMark[], screen: number): ReviewRow[] {
  return marks.flatMap((mark, i) => {
    const here = partsOnScreen(mark, screen)
    if (here.length === 0) return []
    return [
      {
        id: mark.id,
        label: markLabel(i),
        memo: mark.memo,
        partsHere: here.length,
        parts: mark.parts.length,
        screens: screenSpan(mark),
        hasSketch: mark.sketch !== null,
        where: whereOf(mark, screen)
      }
    ]
  })
}

/**
 * 굳힌 화면들 + 지금 보고 있는 화면. 배열 차례가 곧 흐름 차례다.
 *
 * 지금 화면을 **늘 끝에 붙인다** — 아직 안 굳혔어도 목록에 서야 한다. 안 보이면 방금 그린
 * 것이 어디 갔는지 알 수 없고, 그 화면의 항목을 고칠 자리도 없어진다.
 */
export function reviewScreens(
  steps: readonly DraftStep[],
  marks: readonly DraftMark[],
  current: { seq: number; label: string }
): ReviewScreen[] {
  const frozen = steps.map((step, i) => ({
    seq: step.seq,
    step: i + 1,
    label: step.location.label,
    current: false,
    hasImage: step.hasImage,
    rows: rowsOnScreen(marks, step.seq)
  }))
  return [
    ...frozen,
    {
      seq: current.seq,
      step: steps.length + 1,
      label: current.label,
      current: true,
      hasImage: false,
      rows: rowsOnScreen(marks, current.seq)
    }
  ]
}
