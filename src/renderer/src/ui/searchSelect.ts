/**
 * 검색 카드의 순수 로직(§db-remote.data.filter AC-1b) — 화면 없이 판정되는 부분.
 * 컴포넌트는 `search-select.tsx`.
 */

export interface SearchOption {
  value: string
  /** 화면에 보이는 글자. 값과 다를 수 있다(연산자: 값 `!=` · 라벨 `같지 않다`). */
  label: string
  /** 라벨 뒤에 흐리게 붙는 곁말 — 컬럼 타입처럼 고를 때 참고가 되는 것. 검색 대상은 아니다. */
  hint?: string
}

/**
 * 검색어로 거른 목록. 부분일치로 남기되 **앞글자부터 맞는 것을 위로** 올린다 —
 * `user` 를 칠 때 사람이 찾는 건 대개 `user_id` 지 `created_by_user` 가 아니다.
 * 같은 등급 안에서는 원래 순서를 지킨다(컬럼은 표에 정의된 순서 자체가 정보다).
 */
export function filterOptions(options: readonly SearchOption[], query: string): SearchOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...options]
  const hit: SearchOption[] = []
  const rest: SearchOption[] = []
  for (const o of options) {
    const value = o.value.toLowerCase()
    const label = o.label.toLowerCase()
    if (value.startsWith(q) || label.startsWith(q)) hit.push(o)
    else if (value.includes(q) || label.includes(q)) rest.push(o)
  }
  return [...hit, ...rest]
}

/**
 * 커서를 옮긴다(`delta` 는 -1/+1, 0 이면 지금 자리를 범위 안으로만 당긴다).
 * 목록이 비면 `-1` — 가리킬 것이 없다는 뜻이고, 이 값이면 Enter 가 아무것도 안 고른다.
 * 검색어를 더 쳐서 후보가 줄면 커서가 범위 밖에 남을 수 있어 항상 다시 감싸 준다.
 */
export function moveCursor(current: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const base = current >= length ? length - 1 : current < 0 ? 0 : current
  return (((base + delta) % length) + length) % length
}
