import type { FeedbackLocation, FeedbackRect, FeedbackTarget } from '@shared/devFeedback'

/**
 * 개발용 화면 피드백 도구의 그리기 값 — 화면 위 오버레이와 스케치판이 같이 쓴다.
 *
 * 여기 있는 색·굵기는 앱 디자인 토큰을 일부러 안 쓴다. 이 도구가 필요한 순간은 화면이나
 * 토큰이 깨져 있을 때이고, 스케치판에서는 이 값들이 CSS 가 아니라 **캔버스에 그대로
 * 구워지는 색**이라 CSS 변수로 둘 수도 없다.
 */

export interface Point {
  x: number
  y: number
}

/** 그리기 도구. 지우개만 자국을 만들지 않고 이미 그린 것을 집어 지운다. */
export type Tool = 'pen' | 'line' | 'arrow' | 'box' | 'eraser'
export type DrawTool = Exclude<Tool, 'eraser'>

/**
 * 그린 자국 하나.
 * `points` 는 도구에 따라 뜻이 다르다 — 펜은 지나온 모든 점, 나머지는 [시작, 끝] 둘뿐이다.
 * 실제로 어떤 선이 되는지는 `polylinesOf`(draw.ts) 한 곳만 안다.
 */
export interface Shape {
  tool: DrawTool
  points: Point[]
  color: string
  width: number
}

/** 묶음 안의 표시 하나 — 자국(또는 자리) 한 벌과 그 자리에 있던 요소. */
export interface MarkPart {
  /** 콕 집은 자리(pin)인지, 그려서 두른 자국(shape)인지. 몸짓이 가른다 — 콕 누르면 핀. */
  kind: 'pin' | 'shape'
  /** 핀이면 없다 — 자리만 있고 그린 것이 없다. */
  shape: Shape | null
  /** 창(뷰포트) 좌표. 그리는 동안 화면을 얼려두므로 캡처 이미지와 그대로 맞물린다. */
  bounds: FeedbackRect
  target: FeedbackTarget | null
  /**
   * 어느 **화면**에서 그린 것인가 — `DraftStep.seq` 를 가리킨다.
   *
   * 흐름 차례(1단계·2단계)가 아니라 화면의 신원이다. 순서를 바꿀 때 표시를 하나하나
   * 고쳐 주지 않아도 되도록 갈라 뒀다 — 차례는 화면 목록에서 세면 나온다.
   * 좌표가 **그 화면의 창 기준**이라, 이게 없으면 A화면에서 그린 것이 B화면의
   * 엉뚱한 자리를 가리킨다.
   */
  screen: number
}

/**
 * 흐름의 한 차례 = 화면 하나. "다음 화면"으로 굳힐 때 하나씩 는다.
 *
 * `seq` 는 **뜬 순서**(초안 폴더의 `screen-N.png`)이고 절대 안 바뀐다. 배열에서의
 * 자리가 **흐름 차례**다. 둘을 가른 덕에 순서 바꾸기가 배열만 흔들고 끝난다 —
 * 이미 메인이 쓴 그림 파일을 다시 옮기지 않는다.
 */
export interface DraftStep {
  seq: number
  location: FeedbackLocation
  viewport: { width: number; height: number }
  /** 캡처가 실패했으면 false. 그래도 좌표와 요소는 살아 있어 피드백은 무산되지 않는다. */
  hasImage: boolean
}

/**
 * 아직 저장되지 않은, 화면 위에서 편집 중인 **묶음** 하나.
 *
 * 표시 하나가 아니라 묶음인 이유: 화살표 긋고 상자 치고 핀 꽂은 것이 결국 한 요청일
 * 때가 있다. 그때 메모를 셋으로 나눠 받으면 같은 말을 세 번 적게 된다.
 * 요소(`target`)는 묶음이 아니라 표시마다 잡는다 — 묶음 전체를 감싼 사각형으로 재면
 * 표시들 사이의 거대한 상위 감싸개가 잡힌다.
 */
export interface DraftMark {
  id: number
  /** 이 묶음에 든 표시들. 최소 하나 — 비면 묶음 자체가 사라진다. */
  parts: MarkPart[]
  memo: string
  /** "이렇게 생겼으면 좋겠다" 그림 — 스케치판에서 그린 PNG 데이터 URL. 없으면 null.
   *  묶음 하나가 한 요청이므로 그림도 묶음당 한 장이다. */
  sketch: string | null
}

/** 기본 표시 색 — 앱 팔레트와 절대 섞이지 않는 값으로 못박는다(화이트 테마 위에서 확실히 튄다). */
export const MARK_COLOR = '#eb4e63'
/** 어두운 배경 위에서도 표시가 보이도록 아래에 까는 흰 테두리. */
export const MARK_HALO = 'rgba(255,255,255,0.92)'
export const MARK_WIDTH = 3

/**
 * 펜 색 다섯. 이 정도면 "무엇을 뜻하는 색인가"를 쓰는 사람이 스스로 정해 쓸 만하고,
 * 그 이상은 고르는 것 자체가 일이 된다.
 */
export const PALETTE = [MARK_COLOR, '#2f6df6', '#17a34a', '#f59e0b', '#1f2130'] as const

/** 그림이 딸렸다는 표식의 색(배지 어깨 점·'그림 고치기' 글자). 팔레트의 초록과 같은 값을
 *  쓰되 이름을 따로 준다 — 팔레트를 손보다 이 표식 색까지 같이 바뀌면 안 된다. */
export const SKETCH_BADGE_COLOR = '#17a34a'

/** 굵기 3단. 가운데가 기본이고 예전 한 자루 펜과 같은 굵기다. */
export const WIDTHS = [2, MARK_WIDTH, 6] as const

/** 스케치판이 흰 바탕을 쓰는 이유: 화면을 깔면 "지금 화면 고치기"가 되어 화면 위 그리기와 겹친다. */
export const SKETCH_BACKGROUND = '#ffffff'
