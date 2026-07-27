/**
 * 첫 창 크기 계산(순수 — electron 을 import 하지 않아 테스트 가능).
 *
 * 화면 작업영역(메뉴바·독 제외)의 90% 안에 16:10 직사각형을 내접시키고 상·하한을 둔다.
 * 고정 1320×840 은 요즘 모니터에서 너무 작았고(사이드바 + 그리드가 한 화면에 안 들어옴),
 * 그렇다고 무한정 키우면 초광폭 모니터에서 한 줄이 화면 끝까지 늘어져 읽기 어렵다.
 * 상한(1920×1200)은 이 앱의 최대 콘텐츠 폭(그리드 1160 + 사이드바 둘)이 여유롭게 들어가는 선.
 * 가로·세로를 각각 90% 로 줄이면 화면 비율을 그대로 물려받아 정사각형에 가까운 화면에서
 * 창도 정사각형이 됐다 — 이 앱은 가로로 넓은 레이아웃(사이드바 + 표)이라 비를 고정한다.
 */
export interface Size {
  width: number
  height: number
}

/** 화면 작업영역(왼위 좌표 + 크기). Electron `Display.workArea` 와 같은 모양. */
export interface Rect extends Size {
  x: number
  y: number
}

export const WINDOW_MIN: Size = { width: 1120, height: 720 }
export const WINDOW_MAX: Size = { width: 1920, height: 1200 }
const RATIO = 0.9
/** 첫 창의 가로:세로 비 — 상한(1920×1200)과 같은 16:10. */
export const WINDOW_ASPECT = 16 / 10

export function defaultWindowSize(work: Size, min: Size = WINDOW_MIN, max: Size = WINDOW_MAX): Size {
  // 작업영역보다 큰 창은 만들지 않는다 — 상한을 작업영역으로 한 번 더 조인다.
  const capW = Math.min(max.width, work.width)
  const capH = Math.min(max.height, work.height)

  // 가로 기준으로 잡고, 세로가 한계를 넘으면 세로 기준으로 되잡는다(짧은 쪽이 비를 지킨다).
  let width = Math.min(work.width * RATIO, capW)
  let height = width / WINDOW_ASPECT
  if (height > work.height * RATIO || height > capH) {
    height = Math.min(work.height * RATIO, capH)
    width = Math.min(height * WINDOW_ASPECT, capW)
  }

  // 하한은 마지막에 밀어 올린다. 단 작업영역을 넘지 않는 선까지만
  // (작은 노트북 화면에서 하한이 화면을 넘어서면 창이 화면 밖으로 삐져나간다).
  return {
    width: Math.round(Math.max(width, Math.min(min.width, work.width))),
    height: Math.round(Math.max(height, Math.min(min.height, work.height)))
  }
}

/**
 * 첫 창의 위치까지 정한다 — 띄울 화면 하나를 골라 그 안에서 중앙에 놓는다.
 *
 * BrowserWindow 의 `center: true` 는 여러 모니터의 합집합을 기준으로 중앙을 잡아서,
 * 창이 좁은 세로 모니터에 걸치면 macOS 가 폭을 그 모니터 폭으로 잘라 버렸다
 * (1620×1013 로 만든 창이 1080×1013 — 정사각형처럼 보이던 실제 원인. 실측 확인).
 * 위치를 우리가 못박으면 크기가 계산대로 남는다.
 */
export function defaultWindowBounds(work: Rect, min: Size = WINDOW_MIN, max: Size = WINDOW_MAX): Rect {
  const { width, height } = defaultWindowSize(work, min, max)
  return {
    width,
    height,
    x: Math.round(work.x + (work.width - width) / 2),
    y: Math.round(work.y + (work.height - height) / 2)
  }
}
