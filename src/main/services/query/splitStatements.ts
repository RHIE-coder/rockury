/**
 * SQL 다중문 분리(§ops-plan Phase 2c) — 문자열/주석/괄호를 인지해 `;` 로 문장을 나눈다.
 * rky splitStatements 를 이식하며 주석 처리 결함을 고친다: 라인 주석(--)과
 * 블록 주석 안의 `;` 로 잘못 쪼개지던 문제. 순수 함수 → 테스트 의무 대상.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  type State = 'normal' | 'single' | 'double' | 'line' | 'block'
  let state: State = 'normal'

  let i = 0
  const n = sql.length
  const push2 = (a: string, b: string | undefined): void => {
    cur += a
    if (b !== undefined) {
      cur += b
      i += 2
    } else {
      i += 1
    }
  }

  while (i < n) {
    const ch = sql[i]
    const next = i + 1 < n ? sql[i + 1] : undefined

    if (state === 'line') {
      cur += ch
      if (ch === '\n') state = 'normal'
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        cur += '*/'
        i += 2
        state = 'normal'
        continue
      }
      cur += ch
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"'
      if (ch === '\\') {
        push2(ch, next) // 이스케이프 — 다음 문자를 그대로 소비
        continue
      }
      if (ch === quote) {
        if (next === quote) {
          push2(ch, next) // 따옴표 중첩('' 또는 "")
          continue
        }
        cur += ch
        i++
        state = 'normal'
        continue
      }
      cur += ch
      i++
      continue
    }

    // normal
    if (ch === '-' && next === '-') {
      state = 'line'
      push2(ch, next)
      continue
    }
    if (ch === '/' && next === '*') {
      state = 'block'
      push2(ch, next)
      continue
    }
    if (ch === "'") {
      state = 'single'
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      state = 'double'
      cur += ch
      i++
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)

    if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }

  if (cur.trim()) out.push(cur.trim())
  return out
}
