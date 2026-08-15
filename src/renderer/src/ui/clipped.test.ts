import { describe, expect, it } from 'vitest'
import { clipBox, clipVerdict } from './clipped'

describe('clipVerdict — 이번 측정을 답으로 쓸지', () => {
  it('내용이 상자보다 넓으면 잘림', () => {
    expect(clipVerdict(376, 211)).toBe(true)
  })

  it('내용이 상자 안에 들면 안 잘림', () => {
    expect(clipVerdict(120, 211)).toBe(false)
  })

  it('1px 안쪽은 안 잘림으로 본다 — 소수점 반올림에 손잡이가 껌뻑이지 않게', () => {
    expect(clipVerdict(212, 211)).toBe(false)
    expect(clipVerdict(213, 211)).toBe(true)
  })

  /**
   * 회귀 — 2026-08-13 사용자: "편집 이후에 다시 나오면 또 이러는데?"
   *
   * 칸을 눌러 편집을 열면 그 칸이 입력 상자로 바뀌며 DOM 에서 빠진다. 빠지는 순간
   * ResizeObserver 가 크기 0 으로 울리는데, 그 0 을 "안 넘침"으로 받아 적어 손잡이가 사라졌고
   * 편집을 닫아도 다시 잴 계기가 없어 영영 안 돌아왔다. 폭 0 은 **잴 수 없음**이다.
   */
  it('폭 0 은 답이 아니다 — 이전 판정을 덮지 않게 null', () => {
    expect(clipVerdict(0, 0)).toBeNull()
    // 빠진 칸이라도 scrollWidth 는 남을 수 있다 — 기준은 어디까지나 상자 폭이다.
    expect(clipVerdict(376, 0)).toBeNull()
    expect(clipVerdict(0, -1)).toBeNull()
  })
})

describe('clipBox', () => {
  it('접히면 한 줄로 자르고, 펴면 줄을 바꾼다', () => {
    expect(clipBox(false)).toBe('truncate')
    expect(clipBox(true)).toBe('whitespace-pre-wrap break-words')
  })
})
