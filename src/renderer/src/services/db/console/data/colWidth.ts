/**
 * Data 그리드 컬럼 폭 자동 계산(§ops 향상 — Data). 순수 함수 → 테스트 의무.
 *
 * 고정 폭(160px)이면 긴 값이 전부 잘려 "내용을 보려면 일일이 늘려야" 했다.
 * 헤더(컬럼명·타입 라벨)와 실제 값 길이 중 가장 긴 것에 맞추되, 한 컬럼이 화면을
 * 독차지하지 않도록 상한을 둔다(상한을 넘는 값은 계속 잘리고 셀 도구로 전체를 본다).
 */

export interface AutoWidthOptions {
  /** 아무리 짧아도 이 폭은 준다. */
  min?: number
  /** 아무리 길어도 이 폭을 넘지 않는다. */
  max?: number
  /** 모노 12px 기준 글자 하나의 대략 폭. */
  charPx?: number
  /** 좌우 여백 + 정렬 아이콘 등 고정 가산. */
  padPx?: number
  /** 헤더에 붙는 키 배지(PK/FK…) 한 개당 가산. */
  badgePx?: number
  /** 폭 계산에 참고할 행 수 상한 — 페이지가 커도 비용을 묶어 둔다. */
  sampleRows?: number
}

export const COL_WIDTH_DEFAULTS: Required<AutoWidthOptions> = {
  min: 88,
  max: 420,
  charPx: 7.2,
  padPx: 30,
  badgePx: 22,
  sampleRows: 200
}

export interface WidthColumn {
  name: string
  /** 헤더 둘째 줄에 작게 붙는 타입 라벨(없으면 생략). */
  typeLabel?: string
  /** 헤더에 붙는 키 배지 개수. */
  badges?: number
  /**
   * 셀 안에서 값이 아닌 것이 차지하는 폭(px) — 편집 셀의 `NULL`·`FK` 버튼, JSON 요약 칩 등.
   * 이걸 빼먹으면 계산은 맞는데 화면에선 값이 잘린다(버튼이 값 자리를 먹어서).
   */
  trailingPx?: number
}

/** 셀에 실제로 그려지는 문자열의 길이 — 객체는 JSON, null 은 `NULL` 로 보인다. */
export function cellTextLength(v: unknown): number {
  if (v === null || v === undefined) return 4 // 'NULL'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v).length
    } catch {
      return 8
    }
  }
  return String(v).length
}

/**
 * 컬럼별 폭(px) — 헤더와 표본 행의 최장 길이에서 계산한다.
 * 반환에는 모든 컬럼이 담긴다(값이 없는 컬럼도 헤더 기준 폭을 받는다).
 */
export function autoColumnWidths(
  columns: WidthColumn[],
  rows: Record<string, unknown>[],
  opts: AutoWidthOptions = {}
): Record<string, number> {
  const o = { ...COL_WIDTH_DEFAULTS, ...opts }
  const sample = rows.slice(0, o.sampleRows)
  const out: Record<string, number> = {}

  for (const c of columns) {
    // 타입 라벨은 더 작은 글자(10px)라 같은 글자 수라도 덜 넓다.
    const headerChars = Math.max(c.name.length, (c.typeLabel?.length ?? 0) * 0.83)
    let longest = headerChars
    for (const row of sample) {
      const len = cellTextLength(row[c.name])
      if (len > longest) longest = len
    }
    const raw = longest * o.charPx + o.padPx + (c.badges ?? 0) * o.badgePx + (c.trailingPx ?? 0)
    out[c.name] = Math.round(Math.min(o.max, Math.max(o.min, raw)))
  }
  return out
}
