/**
 * 결과 행 상세 보기의 **값 판정** — 이 값을 그냥 글자로 보일지, JSON 으로 펴서 보일지.
 * 그리기(모달)는 `RowDetailDialog` 가 하고, 여기서는 판정만 한다.
 *
 * 정본: `docs/spec/db-remote.md` §db-remote.result-grid.row-detail.
 */

export type CellView =
  /** 값 없음 — 빈 문자열과 구분해 보여야 한다(`NULL` vs `''`). */
  | { kind: 'null' }
  /** JSON 으로 읽히는 값 — 들여쓴 원문을 준다. */
  | { kind: 'json'; text: string }
  /** 그 밖의 모든 것 — 있는 그대로. */
  | { kind: 'text'; text: string }

/**
 * 드라이버가 이미 객체로 준 값(JSON 컬럼)과, 문자열로 온 JSON 을 모두 잡는다.
 *
 * 문자열은 **`{` 나 `[` 로 시작할 때만** JSON 으로 본다. `JSON.parse` 만으로 가르면
 * `"123"`·`"true"`·`"null"` 같은 평범한 값까지 JSON 이 되어, 숫자 한 칸이 "JSON 블록"으로
 * 그려진다. 여는 괄호로 시작하는 것만 보는 편이 사람의 기대와 맞는다.
 */
export function viewCell(value: unknown): CellView {
  if (value === null || value === undefined) return { kind: 'null' }

  if (typeof value === 'object') {
    // Date 등은 객체지만 JSON 으로 펴 봐야 읽을 게 없다 — 글자로 보인다.
    if (value instanceof Date) return { kind: 'text', text: value.toISOString() }
    try {
      return { kind: 'json', text: JSON.stringify(value, null, 2) }
    } catch {
      // 순환 참조 등 — 펼 수 없으면 글자로.
      return { kind: 'text', text: String(value) }
    }
  }

  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return { kind: 'json', text: JSON.stringify(JSON.parse(t), null, 2) }
      } catch {
        // 괄호로 시작하지만 깨진 JSON — 고쳐 주지 않고 원문 그대로 보인다.
        return { kind: 'text', text: value }
      }
    }
    return { kind: 'text', text: value }
  }

  return { kind: 'text', text: String(value) }
}

/** 행 하나를 클립보드용 JSON 으로. 컬럼 순서를 화면과 같게 맞춘다. */
export function rowToJson(columns: string[], row: Record<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const c of columns) out[c] = row[c] ?? null
  return JSON.stringify(out, null, 2)
}
