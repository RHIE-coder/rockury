import { describe, expect, it } from 'vitest'
import {
  appendPart,
  isLastPart,
  mergeMarks,
  moveStep,
  partsOnScreen,
  removePart,
  removeStep,
  screenSpan,
  splitMark
} from './group'
import type { DraftMark, DraftStep, MarkPart } from './types'

/**
 * 묶음·흐름 회귀 테스트.
 * 여기서 지키는 선은 하나다 — **사용자가 남긴 것을 조용히 잃지 않는다.** 잘못 묶여
 * 메모가 사라지거나 화면을 빼며 표시가 딸려 가는 것은, 보내고 나서야 드러나는 손해다.
 */

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

describe('묶음에 자국 붙이고 떼기', () => {
  it('열려 있는 묶음에 자국이 붙는다 — 그게 "여럿을 한 맥락으로"의 전부다', () => {
    const next = appendPart([mark()], 1, part({ kind: 'pin' }))
    expect(next[0].parts).toHaveLength(2)
    expect(next[0].parts[1].kind).toBe('pin')
  })

  it('마지막 자국을 떼면 묶음도 같이 사라진다 — 어디를 가리키는지 모르는 메모는 남길 수 없다', () => {
    expect(removePart([mark({ memo: '여기' })], 1, 0)).toEqual([])
  })

  it('자국이 여럿이면 그 하나만 떨어지고 메모는 그대로다', () => {
    const before = mark({ parts: [part(), part({ kind: 'pin' })], memo: '옮겨라' })
    const after = removePart([before], 1, 0)
    expect(after[0].parts).toHaveLength(1)
    expect(after[0].memo).toBe('옮겨라')
  })

  it('마지막 하나인지 미리 알 수 있다 — 메모창을 같이 닫아야 하는 자리', () => {
    expect(isLastPart([mark()], 1)).toBe(true)
    expect(isLastPart([mark({ parts: [part(), part()] })], 1)).toBe(false)
  })
})

describe('나중에 묶기', () => {
  it('메모는 버리지 않고 이어 붙인다 — 이미 적어 둔 말이라 하나만 남기면 손해다', () => {
    const res = mergeMarks(
      [mark({ id: 1, memo: '이 카드를' }), mark({ id: 2, memo: '저 목록으로' })],
      [1, 2]
    )
    expect(res.marks).toHaveLength(1)
    expect(res.marks[0].memo).toBe('이 카드를 / 저 목록으로')
    expect(res.marks[0].parts).toHaveLength(2)
  })

  it('자리는 맨 앞 것이 이어받는다 — 번호가 밀리면 이미 본 배지와 어긋난다', () => {
    const res = mergeMarks(
      [mark({ id: 1 }), mark({ id: 2 }), mark({ id: 3 })],
      [2, 3]
    )
    expect(res.marks.map((m) => m.id)).toEqual([1, 2])
  })

  it('그림은 묶음당 한 장이라 맨 앞 것만 남고, 버린 수를 알려 준다', () => {
    const res = mergeMarks(
      [mark({ id: 1, sketch: 'A' }), mark({ id: 2, sketch: 'B' })],
      [1, 2]
    )
    expect(res.marks[0].sketch).toBe('A')
    expect(res.droppedSketches).toBe(1)
  })

  it('하나만 고르면 아무 일도 안 한다', () => {
    expect(mergeMarks([mark()], [1]).marks).toHaveLength(1)
  })
})

describe('풀기', () => {
  it('표시마다 따로 서고, 메모·그림은 맨 앞 표시가 물려받는다', () => {
    let id = 9
    const before = mark({ parts: [part(), part({ kind: 'pin' })], memo: '옮겨라', sketch: 'A' })
    const after = splitMark([before], 1, () => (id += 1))
    expect(after).toHaveLength(2)
    expect(after[0].memo).toBe('옮겨라')
    expect(after[0].sketch).toBe('A')
    // 베껴 나눠 주면 사용자가 안 한 말이 늘어난다.
    expect(after[1].memo).toBe('')
    expect(after[1].sketch).toBeNull()
  })

  it('표시가 하나뿐이면 풀 것이 없다', () => {
    expect(splitMark([mark()], 1, () => 99)).toHaveLength(1)
  })
})

describe('화면을 걸친 묶음', () => {
  it('걸친 화면 수를 센다 — 목록·메모창이 "화면 N개"를 밝히는 근거', () => {
    expect(screenSpan(mark({ parts: [part({ screen: 1 }), part({ screen: 2 })] }))).toBe(2)
    expect(screenSpan(mark({ parts: [part({ screen: 1 }), part({ screen: 1 })] }))).toBe(1)
  })

  it('지금 화면의 표시만 골라 준다 — 지난 화면 자국은 이미 자기 그림에 구워졌다', () => {
    const m = mark({ parts: [part({ screen: 1 }), part({ screen: 2 }), part({ screen: 2 })] })
    expect(partsOnScreen(m, 2)).toHaveLength(2)
    expect(partsOnScreen(m, 3)).toHaveLength(0)
  })
})

describe('흐름 차례 고치기', () => {
  it('화면을 옮겨도 표시는 손대지 않는다 — 표시가 붙잡은 것은 차례가 아니라 화면 신원이다', () => {
    const moved = moveStep([step(1), step(2), step(3)], 2, -1)
    expect(moved.map((s) => s.seq)).toEqual([1, 3, 2])
  })

  it('끝을 넘어가는 이동은 아무 일도 안 한다 — 목록 끝을 도는 것보다 예측 가능하다', () => {
    expect(moveStep([step(1), step(2)], 0, -1).map((s) => s.seq)).toEqual([1, 2])
    expect(moveStep([step(1), step(2)], 1, 1).map((s) => s.seq)).toEqual([1, 2])
  })

  it('화면을 빼면 그 화면의 표시도 같이 사라진다 — 좌표가 그 화면 기준이라 남길 데가 없다', () => {
    const marks = [
      mark({ id: 1, parts: [part({ screen: 1 })] }),
      mark({ id: 2, parts: [part({ screen: 1 }), part({ screen: 2 })] })
    ]
    const res = removeStep([step(1), step(2)], marks, 0)
    expect(res.steps.map((s) => s.seq)).toEqual([2])
    // 1번 묶음은 통째로 사라지고, 2번은 2화면 표시만 남아 살아남는다.
    expect(res.marks.map((m) => m.id)).toEqual([2])
    expect(res.marks[0].parts).toHaveLength(1)
  })

  it('남은 화면의 신원은 다시 매기지 않는다 — 다시 매기면 살아남은 표시가 엉뚱한 그림에 붙는다', () => {
    const res = removeStep([step(1), step(2), step(3)], [mark({ parts: [part({ screen: 3 })] })], 0)
    expect(res.steps.map((s) => s.seq)).toEqual([2, 3])
    expect(res.marks[0].parts[0].screen).toBe(3)
  })

  it('없는 자리를 빼라고 하면 그대로 둔다', () => {
    const res = removeStep([step(1)], [mark()], 5)
    expect(res.steps).toHaveLength(1)
    expect(res.marks).toHaveLength(1)
  })
})
