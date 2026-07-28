import type { Layout } from '../types'
import { tokenRef } from './tokens'

/**
 * 배치 데이터 → CSS — 명세 정본 `docs/spec/uiux-ia.md` §6.
 *
 * 좌표가 없으므로 여기서 하는 일은 **방향과 칸 수를 CSS 로 옮기는 것**뿐이다.
 * 그래서 같은 구조가 폭만 바꿔도 안 깨진다(뷰포트 셋이 한 화면으로 성립하는 근거).
 */

/** 간격 값 — 토큰 경로면 `var(--t-…)` 로, 아니면 그대로(길이 리터럴도 허용한다). */
function gapValue(gap: string | undefined): string {
  if (!gap) return tokenRef('space.md')
  // 점이 있으면 토큰 경로로 본다(`space.md`). CSS 길이에는 점이 있어도 단위가 붙는다(`1.5rem`).
  return /^[a-z][\w.]*\.[\w]+$/i.test(gap) ? tokenRef(gap) : gap
}

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch'
}

const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between'
}

/**
 * 배치를 인라인 스타일 문자열로. 기본은 세로 쌓기.
 *
 * **가로(row)는 기본 줄바꿈**이다 — 안 하면 좁은 폭에서 옆 항목을 밀어내 깨진다.
 * 한 줄로 고정하려면 `wrap: false` 를 명시한다(의도가 데이터에 남는다).
 */
export function layoutStyle(layout?: Layout): string {
  const type = layout?.type ?? 'stack'
  const gap = `gap:${gapValue(layout?.gap)}`

  if (type === 'grid') {
    const columns = Math.max(1, Math.min(layout?.columns ?? 2, 12))
    const parts = [`display:grid`, `grid-template-columns:repeat(${columns},minmax(0,1fr))`, gap]
    if (layout?.align) parts.push(`align-items:${ALIGN[layout.align] ?? 'stretch'}`)
    return parts.join(';')
  }

  const parts = ['display:flex', `flex-direction:${type === 'row' ? 'row' : 'column'}`, gap]
  if (type === 'row' && layout?.wrap !== false) parts.push('flex-wrap:wrap')
  // 세로 쌓기의 기본은 stretch — 자식이 폭을 꽉 채워야 좁은 화면에서 자연스럽다.
  parts.push(`align-items:${ALIGN[layout?.align ?? (type === 'row' ? 'center' : 'stretch')] ?? 'stretch'}`)
  if (layout?.justify) parts.push(`justify-content:${JUSTIFY[layout.justify] ?? 'flex-start'}`)
  return parts.join(';')
}
