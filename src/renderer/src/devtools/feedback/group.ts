import type { DraftMark, DraftStep, MarkPart } from './types'

/**
 * 묶음 다루기 — 표시를 붙이고, 떼고, 흩어진 것을 하나로 묶고, 도로 가른다.
 * 흐름(화면 여럿)에서 화면 차례를 바꾸고 빼는 일도 여기가 맡는다.
 *
 * 왜 화면(오버레이)에서 갈라 뒀나: 여기가 "무엇이 한 요청인가"를 정하는 자리다.
 * 잘못 묶이면 적어 둔 메모가 엉뚱한 자국에 붙거나 조용히 사라지는데, 그 손해는
 * 보내고 나서야 드러난다. 화면에 묶여 있으면 그걸 테스트로 못 박을 수가 없다.
 */

/** 지금 열려 있는 묶음에 자국 하나를 더 붙인다. */
export function appendPart(marks: readonly DraftMark[], id: number, part: MarkPart): DraftMark[] {
  return marks.map((m) => (m.id === id ? { ...m, parts: [...m.parts, part] } : m))
}

/**
 * 묶음에서 표시 하나를 뗀다. **마지막 하나를 떼면 묶음도 같이 사라진다** —
 * 표시가 없는 메모는 어디를 가리키는지 알 수 없어 남겨 둘 수가 없다.
 */
export function removePart(marks: readonly DraftMark[], id: number, index: number): DraftMark[] {
  return marks.flatMap((m) => {
    if (m.id !== id) return [m]
    const parts = m.parts.filter((_, i) => i !== index)
    return parts.length > 0 ? [{ ...m, parts }] : []
  })
}

/** 이 묶음이 통째로 사라질 자리인가 — 메모창을 같이 닫아야 하는지 판단할 때 쓴다. */
export function isLastPart(marks: readonly DraftMark[], id: number): boolean {
  const mark = marks.find((m) => m.id === id)
  return mark !== undefined && mark.parts.length <= 1
}

/**
 * 메모를 고친다. 화면을 걸친 묶음도 메모는 한 벌이라 고칠 자리도 한 곳이다 —
 * 훑어보기에서 지난 화면의 메모를 고칠 수 있는 근거가 이것이다(좌표와 달리 메모는
 * 어느 화면에 매여 있지 않다).
 */
export function setMemo(marks: readonly DraftMark[], id: number, memo: string): DraftMark[] {
  return marks.map((m) => (m.id === id ? { ...m, memo } : m))
}

/** 묶음을 통째로 지운다 — 딸린 표시가 화면 여럿에 걸쳐 있어도 다 같이 간다. */
export function removeMark(marks: readonly DraftMark[], id: number): DraftMark[] {
  return marks.filter((m) => m.id !== id)
}

/**
 * 묶음에서 **한 화면 몫만** 뗀다. 다른 화면의 표시는 그대로 남는다.
 *
 * 왜 필요한가: 지난 화면의 자국은 그 화면에서만 만질 수 있어서(좌표가 그 화면 기준),
 * 걸친 묶음에서 한 화면 몫이 잘못됐을 때 예전에는 화면을 통째로 빼는 수밖에 없었다 —
 * 그러면 그 화면의 **남의 표시까지** 사라졌다.
 *
 * 남는 표시가 없으면 묶음도 사라진다(`removePart` 와 같은 규칙 — 표시 없는 메모는
 * 어디를 가리키는지 알 수 없다).
 */
export function removePartsOnScreen(
  marks: readonly DraftMark[],
  id: number,
  screen: number
): DraftMark[] {
  return marks.flatMap((m) => {
    if (m.id !== id) return [m]
    const parts = m.parts.filter((p) => p.screen !== screen)
    return parts.length > 0 ? [{ ...m, parts }] : []
  })
}

export interface MergeResult {
  marks: DraftMark[]
  /** 버려진 제안 그림 수. 묶음당 그림은 한 장이라, 둘 이상이면 맨 앞 것만 남는다. */
  droppedSketches: number
}

/**
 * 따로 남긴 묶음 여럿을 하나로 합친다. 자리는 **맨 앞에 있던 것**을 이어받는다
 * (번호가 뒤로 밀리면 이미 화면에서 본 배지 번호와 어긋난다).
 *
 * 메모는 버리지 않고 이어 붙인다 — 이미 적어 둔 말이라 하나만 남기면 손해다.
 * 그림은 묶음당 한 장이라 맨 앞 것만 남고, 버려진 수를 돌려줘 화면이 알릴 수 있게 한다.
 */
export function mergeMarks(marks: readonly DraftMark[], ids: readonly number[]): MergeResult {
  const picked = marks.filter((m) => ids.includes(m.id))
  if (picked.length < 2) return { marks: [...marks], droppedSketches: 0 }

  const sketches = picked.map((m) => m.sketch).filter((s): s is string => s !== null)
  const merged: DraftMark = {
    id: picked[0].id,
    parts: picked.flatMap((m) => m.parts),
    memo: picked
      .map((m) => m.memo.trim())
      .filter((memo) => memo !== '')
      .join(' / '),
    sketch: sketches[0] ?? null
  }

  return {
    marks: marks.flatMap((m) => (m.id === merged.id ? [merged] : ids.includes(m.id) ? [] : [m])),
    droppedSketches: Math.max(0, sketches.length - 1)
  }
}

/** 이 묶음이 걸친 화면 수. 2 이상이면 "A에서 이러면 B가 이렇다"는 이야기다. */
export function screenSpan(mark: DraftMark): number {
  return new Set(mark.parts.map((p) => p.screen)).size
}

/** 지금 화면에 그려야 할 표시들 — 지난 화면 것은 이미 자기 그림에 구워졌다. */
export function partsOnScreen(mark: DraftMark, screen: number): MarkPart[] {
  return mark.parts.filter((p) => p.screen === screen)
}

/**
 * 흐름에서 한 화면을 위나 아래로 옮긴다.
 *
 * 표시는 **손대지 않는다** — 표시가 붙잡고 있는 것은 차례가 아니라 화면의 신원(`seq`)
 * 이라서, 배열만 흔들면 차례가 알아서 따라온다. 끝을 넘어가는 이동은 그대로 둔다
 * (맨 위에서 "위로"가 아무 일도 안 하는 것이 목록 끝을 도는 것보다 예측 가능하다).
 */
export function moveStep(steps: readonly DraftStep[], from: number, delta: number): DraftStep[] {
  const to = from + delta
  if (from < 0 || from >= steps.length || to < 0 || to >= steps.length) return [...steps]
  const next = [...steps]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * 흐름에서 화면 하나를 뺀다. **그 화면에서 그린 표시도 같이 사라진다** — 좌표가 그
 * 화면 기준이라 남겨 둘 데가 없다. 표시가 다 빠진 묶음은 묶음째 사라진다.
 *
 * 남은 화면의 `seq` 는 안 건드린다. 다시 매기면 살아남은 표시들이 가리키던 화면이
 * 통째로 밀려 엉뚱한 그림에 붙는다.
 */
export function removeStep(
  steps: readonly DraftStep[],
  marks: readonly DraftMark[],
  index: number
): { steps: DraftStep[]; marks: DraftMark[] } {
  const gone = steps[index]
  if (!gone) return { steps: [...steps], marks: [...marks] }
  return {
    steps: steps.filter((_, i) => i !== index),
    marks: marks.flatMap((m) => {
      const parts = m.parts.filter((p) => p.screen !== gone.seq)
      return parts.length > 0 ? [{ ...m, parts }] : []
    })
  }
}

/**
 * 잘못 묶은 것을 도로 가른다. 표시마다 따로 선다.
 * 메모와 그림은 묶음의 것이라 나눌 수가 없다 — **맨 앞 표시가 물려받고** 나머지는 빈 채로
 * 선다. 지어내 나눠 주면 사용자가 안 한 말이 코드로 간다.
 */
export function splitMark(
  marks: readonly DraftMark[],
  id: number,
  nextId: () => number
): DraftMark[] {
  return marks.flatMap((m) => {
    if (m.id !== id || m.parts.length < 2) return [m]
    return m.parts.map((part, i) =>
      i === 0 ? { ...m, parts: [part] } : { id: nextId(), parts: [part], memo: '', sketch: null }
    )
  })
}
