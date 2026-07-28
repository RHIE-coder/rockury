import { absolutePos } from './nesting'
import type { DesignNode } from './types'

/**
 * 설계 다이어그램 내보내기의 **순수 계산** — 파일 이름과 캔버스·이동값.
 * 명세: `docs/spec/infra-architecture.md` §design.canvas AC-6.
 *
 * 캡처 자체(DOM·html-to-image)는 뷰에 둔다. 여기 있는 것은 전부 입력→출력이 결정적이라
 * 테스트로 못 박을 수 있는 것들이다.
 *
 * **DB 서비스의 ERD 내보내기와 계산을 공유하지 않는다.** 저기는 평면(테이블이 다 형제)이고
 * 여기는 **중첩**이라, 좌표가 부모 기준 상대값이다 — 경계를 재려면 절대 좌표로 펴야 한다.
 * 남의 서비스 모듈을 끌어다 쓰면 저쪽이 평면 전제로 고칠 때 여기가 조용히 깨진다.
 */

/** 사각형 하나(@xyflow `getNodesBounds` 반환형과 같은 모양). */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** 내보내기 캔버스 크기 + `.react-flow__viewport` 에 걸 이동·배율. */
export interface ExportViewport {
  width: number
  height: number
  x: number
  y: number
  zoom: number
}

/** `infra-<설계본이름>-<YYYYMMDD-HHmmss>.<확장자>`. 이름은 파일시스템 안전 문자로 정규화한다. */
export function exportFileName(designName: string, ext: 'png' | 'svg', date: Date): string {
  const safe =
    (designName || '').replace(/[^0-9A-Za-z가-힣._-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `infra-${safe}-${stamp}.${ext}`
}

/** 사각형들의 합집합. 빈 배열이면 0 사각형 — 빈 캔버스에서 크래시하지 않는다. */
export function unionBounds(rects: Bounds[]): Bounds {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 그려진 것 전체의 경계 — **자식 좌표를 절대값으로 펴서** 잰다.
 *
 * 자식은 부모 기준 상대 좌표(예: 24,32)를 들고 있어, 그대로 재면 원점 근처에 있는 것으로
 * 잘못 잡혀 캔버스에 빈 곳이 생긴다. 자식이 부모 밖으로 삐져나간 경우도 있으므로
 * 부모 경계만 쓰지 않고 **모든 노드를 편 뒤 합집합**을 낸다.
 */
export function contentBounds(nodes: DesignNode[]): Bounds {
  return unionBounds(
    nodes.map((n) => {
      const p = absolutePos(nodes, n.id)
      return { x: p.x, y: p.y, width: n.w, height: n.h }
    })
  )
}

/**
 * 콘텐츠에 딱 맞는 캔버스와, 좌상단이 `(pad, pad)` 로 오도록 하는 이동값.
 * 원본 배율(zoom=1)로 그려 콘텐츠가 이미지를 가득 채우게 한다.
 *
 * `getViewportForBounds` 를 안 쓰는 이유는 DB 서비스가 겪은 것과 같다 — @xyflow v12 에서
 * 그 padding 인자의 뜻이 '픽셀'에서 '비율'로 바뀌어, 픽셀값을 넘기면 배율이 최소까지 눌린다.
 */
export function exportViewport(bounds: Bounds, pad: number): ExportViewport {
  const width = Math.ceil(bounds.width) + pad * 2
  const height = Math.ceil(bounds.height) + pad * 2
  return { width, height, x: pad - bounds.x, y: pad - bounds.y, zoom: 1 }
}
