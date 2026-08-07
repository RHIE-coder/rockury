import type { Rect, Size } from './windowSize'

/**
 * 탭을 끌어 창으로 떼어내고 · 다른 창이 도로 삼키는 일의 **순수 계산**(electron 을 import 하지
 * 않아 테스트가 된다). 실제로 창을 만들고 옮기고 감추는 일은 `ipc/window.ts` 가 한다.
 *
 * 좌표를 누가 드느냐가 이 파일의 핵심이다 — **화면 좌표는 메인만 만든다.** 렌더러는 제 창 안
 * 좌표(`clientX`·`clientY`)만 보내고, 메인이 그 창의 자리를 더해 화면 좌표로 편다. 렌더러가
 * 화면 좌표를 직접 재면(`window.screenX`) 창을 옮긴 뒤 값이 낡고, 자동 검사가 만드는 마우스
 * 입력에는 아예 안 실린다.
 */

export interface Point {
  x: number
  y: number
}

/** 탭 줄이 **창 안에서** 차지한 자리. 화면 좌표가 아니라 창 기준이라 창을 옮겨도 안 낡는다. */
export interface StripRect {
  left: number
  top: number
  width: number
  height: number
}

/** 탭 줄을 든 창 하나 — `content` 는 그 창의 화면상 자리(`getContentBounds`). */
export interface WindowStrip<T> {
  id: T
  content: Rect
  strip: StripRect
}

/**
 * 탭 줄 위아래로 이만큼(px)까지는 "줄 위"로 쳐 준다.
 *
 * 줄 높이가 32px 뿐이라 그대로 재면 창을 끌고 오다 몇 px 차이로 미끄러진다 — 삼켜지지 않으면
 * 사용자는 "다시 넣기가 안 되네"로 읽지, 몇 px 모자랐다고는 못 읽는다.
 */
export const STRIP_CATCH = 10

/**
 * 이 점이 어느 창의 탭 줄 위인가 — 없으면 null.
 *
 * **뒤에서부터 본다**: 겹친 창 중 나중에 뜬 쪽이 위일 확률이 높은데, 메인이 창 쌓임 순서를
 * 정확히 알 길은 없다(`getAllWindows` 는 만든 순서다). 확실한 값이 없으니 더 그럴듯한 쪽을 고른다.
 */
export function stripUnderPoint<T>(
  windows: readonly WindowStrip<T>[],
  point: Point,
  catchMargin = STRIP_CATCH
): T | null {
  for (let i = windows.length - 1; i >= 0; i--) {
    const { id, content, strip } = windows[i]
    const left = content.x + strip.left
    const top = content.y + strip.top
    if (
      point.x >= left &&
      point.x <= left + strip.width &&
      point.y >= top - catchMargin &&
      point.y <= top + strip.height + catchMargin
    ) {
      return id
    }
  }
  return null
}

/**
 * 떨어져 나간 창을 놓을 자리 — 잡고 있던 지점(`grab`)이 커서 밑에 그대로 오게 민다.
 * 그래야 탭이 손에 붙어 나온 것처럼 보인다(창이 커서에서 튀면 무엇을 끌고 있는지 놓친다).
 *
 * 작업영역 밖으로는 안 내보낸다 — 화면 밖에 뜬 창은 다시 잡을 수도 닫을 수도 없다.
 */
export function tearOffBounds(size: Size, cursor: Point, grab: Point, work: Rect): Rect {
  // 잡은 지점이 창 크기를 넘을 수 있다 — 꽉 채운 창에서 빼낼 때 창이 작아지기 때문이다.
  // 그대로 쓰면 창이 커서에서 멀찍이 떨어진 자리에 선다.
  const gx = clamp(grab.x, 0, size.width)
  const gy = clamp(grab.y, 0, size.height)
  return {
    width: size.width,
    height: size.height,
    x: clamp(Math.round(cursor.x - gx), work.x, work.x + work.width - size.width),
    y: clamp(Math.round(cursor.y - gy), work.y, work.y + work.height - size.height)
  }
}

/** 창이 작업영역보다 크면 상한이 하한보다 작아진다 — 그때는 왼위 모서리에 붙인다. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}
