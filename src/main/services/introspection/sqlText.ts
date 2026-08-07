/**
 * DDL 글자를 다루는 공용 도구 — 세 벤더 어댑터가 함께 쓴다.
 * 벤더마다 CHECK 식을 `CHECK ((a > 0))` 처럼 괄호를 더 씌워 돌려주는데, 설계부의 식은
 * 괄호 없이 저장되므로 같은 글자로 맞춰야 비교(drift)가 헛돌지 않는다.
 */

/**
 * `open` 의 여는 괄호와 짝이 맞는 닫는 괄호를 찾아 안쪽과 끝 위치를 돌려준다.
 * 따옴표·백틱·대괄호 안의 괄호는 세지 않는다 — `CHECK (name <> ')')` 에서 끊기지 않게.
 * 짝이 안 맞으면 null(잘린 DDL 을 억지로 읽지 않는다).
 */
export function balancedParens(text: string, open: number): { inner: string; end: number } | null {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\' && quote !== '`') i += 1 // 문자열 안의 이스케이프
      else if (ch === quote) {
        if (text[i + 1] === quote) i += 1 // 겹쳐 쓴 인용부호는 글자 하나
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i }
    }
  }
  return null
}

/**
 * 전체를 감싼 괄호 **한 겹**만 벗긴다. `(a) AND (b)` 처럼 전체를 감싼 게 아니면 그대로 둔다.
 */
export function stripOuterParens(expr: string): string {
  const s = expr.trim()
  if (!s.startsWith('(')) return s
  const b = balancedParens(s, 0)
  return b && b.end === s.length - 1 ? b.inner.trim() : s
}

/**
 * `CHECK ((price > 0))` → `price > 0`.
 * 괄호를 **두 겹** 벗긴다: 한 겹은 `CHECK (…)` 문법의 것이고, 한 겹은 PostgreSQL 이 식을
 * 되돌려줄 때 스스로 씌우는 것이다. 전체를 감싼 괄호만 벗기므로 뜻은 안 바뀐다.
 */
export function stripCheckKeyword(def: string): string {
  return stripOuterParens(stripOuterParens(def.trim().replace(/^CHECK\s*/i, '')))
}
