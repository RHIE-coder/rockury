/**
 * ERD 내보내기 파일명 생성(순수) — `erd-<연결명>-<YYYYMMDD-HHmmss>.<ext>`.
 * 연결명은 파일시스템 안전 문자로 정규화(영숫자/._- 외는 `-`), 캡처 로직(DOM·html-to-image)은
 * 뷰에 둔다(테스트는 이 파일명 규칙만 — 나머지는 e2e/수동). 입력→출력 결정적 → 테스트 의무.
 */
export function exportFileName(connName: string, ext: 'png' | 'svg', date: Date): string {
  const safe = (connName || 'diagram').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram'
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `erd-${safe}-${stamp}.${ext}`
}

/** 노드 군집 경계(getNodesBounds 반환형과 동일). */
export interface ExportBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 내보내기 캔버스 크기 + .react-flow__viewport 에 적용할 transform 값. */
export interface ExportViewport {
  width: number
  height: number
  x: number
  y: number
  zoom: number
}

/**
 * ERD 내보내기 캔버스·뷰포트 계산(순수) — 테이블 군집 경계에 딱 맞춰 사방 `pad` 픽셀만 두른다.
 * 원본 스케일(zoom=1)로 그려 콘텐츠가 이미지를 가득 채우게 한다.
 * 왜 getViewportForBounds 를 안 쓰나: @xyflow v12에서 그 padding 인자가 '픽셀'→'비율'로 의미가
 * 바뀌어, 픽셀값(예 48)을 넘기면 캔버스의 ~49%가 여백으로 잡히고 zoom 이 minZoom 까지 눌려
 * 콘텐츠가 캔버스의 일부만 차지(=과도한 여백)한다. 그래서 직접 계산한다.
 * 입력→출력 결정적 → 테스트 의무.
 */
export function exportViewport(bounds: ExportBounds, pad: number): ExportViewport {
  const width = Math.ceil(bounds.width) + pad * 2
  const height = Math.ceil(bounds.height) + pad * 2
  // 콘텐츠 좌상단(bounds.x/y)이 화면 (pad, pad) 로 오도록 평행이동, 원본 스케일 유지.
  return { width, height, x: pad - bounds.x, y: pad - bounds.y, zoom: 1 }
}

/** 여러 사각형의 합집합 경계(순수). 빈 배열이면 0 사각형. 입력→출력 결정적 → 테스트 의무. */
export function unionBounds(rects: ExportBounds[]): ExportBounds {
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
 * 내보내기용 실제 콘텐츠 경계 — 노드 사각형(nodeBounds)에 더해, 노드 밖으로 부푸는 관계선
 * (특히 자기참조 루프)의 경로까지 감싼다. 노드 경계만 쓰면 선이 잘린다.
 * React Flow 엣지 path 의 getBBox 는 뷰포트와 같은 flow 좌표계 → getNodesBounds 결과와
 * 그대로 합집합 가능. DOM 의존이라 뷰에서만 호출(단위테스트는 순수 unionBounds 로 덮음).
 */
export function contentBoundsForExport(root: Element, nodeBounds: ExportBounds): ExportBounds {
  const rects: ExportBounds[] = [nodeBounds]
  root.querySelectorAll<SVGGraphicsElement>('.react-flow__edge-path').forEach((p) => {
    try {
      const b = p.getBBox()
      if (b.width > 0 || b.height > 0) rects.push({ x: b.x, y: b.y, width: b.width, height: b.height })
    } catch {
      /* getBBox 미지원 환경은 무시 — 노드 경계만으로 폴백 */
    }
  })
  return unionBounds(rects)
}
