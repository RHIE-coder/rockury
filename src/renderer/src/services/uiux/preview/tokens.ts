import type { Viewport } from '../types'

/**
 * 기본 디자인 토큰 한 벌
 *
 * 원형(flare)은 토큰도 조각도 프로젝트가 공급하게 했지만, rockury 는 배포되는 앱이라 사용자가
 * **빈손으로 시작**한다. 기본 한 벌이 없으면 첫 미리보기가 아무것도 아닌 회색 상자가 된다.
 * Style 모듈이 서면 이 값들이 사용자 토큰으로 덮인다 — 그때까지의 바탕이다.
 *
 * 이름은 **의도**로 짓는다(`color.primary`, `space.md`) — `blue600` 같은 값 이름을 쓰면
 * 나중에 색을 바꿀 때 이름이 거짓말을 한다.
 */
export type TokenMap = Record<string, string>

export const DEFAULT_TOKENS: TokenMap = {
  'color.bg': '#ffffff',
  'color.surface': '#f8fafc',
  'color.fg': '#111827',
  'color.muted': '#6b7280',
  'color.line': '#e2e8f0',
  'color.primary': '#2563eb',
  'color.primaryText': '#ffffff',
  'color.danger': '#dc2626',
  'space.xs': '4px',
  'space.sm': '8px',
  'space.md': '16px',
  'space.lg': '24px',
  'radius.sm': '6px',
  'radius.md': '10px',
  'radius.pill': '9999px',
  'font.body': '14px',
  'font.small': '12px',
  'font.heading': '20px',
  'font.weightBold': '600',
  'line.body': '1.5',
  'control.height': '36px',
  'border.width': '1px'
}

/**
 * 기본 한 벌 ⊕ 프로젝트가 덮어쓴 값. **덮어쓴 것만 저장하므로** 기본값이 바뀌면 안 건드린 토큰은
 * 자동으로 따라온다 — 전부를 복사해 두면 그 길이 막힌다.
 *
 * 기본에 없는 이름도 받아들인다(열린 어휘) — 프로젝트가 자기 토큰을 더할 수 있다. 다만 조각이
 * 안 쓰는 이름은 아무 데도 안 닿는다(그건 Style 화면이 알려 줄 몫).
 */
export function mergeTokens(overrides: TokenMap | undefined, base: TokenMap = DEFAULT_TOKENS): TokenMap {
  if (!overrides) return base
  const out: TokenMap = { ...base }
  for (const [path, value] of Object.entries(overrides)) {
    // 빈 값은 "기본으로 되돌림"이다 — 지우기와 같은 뜻이라 따로 삭제 동작을 두지 않는다.
    if (typeof value === 'string' && value.trim() !== '') out[path] = value
  }
  return out
}

/** 기본과 다른 값만 추린다 — 저장할 때 차이만 남기기 위한 것. */
export function diffTokens(current: TokenMap, base: TokenMap = DEFAULT_TOKENS): TokenMap {
  const out: TokenMap = {}
  for (const [path, value] of Object.entries(current)) {
    if (base[path] !== value) out[path] = value
  }
  return out
}

/** 토큰을 묶어 보이기 위한 갈래 — 경로의 첫 조각(`color.primary` → `color`). */
export function tokenGroup(path: string): string {
  return path.split('.')[0] || 'etc'
}

/** 토큰 경로 → CSS 변수 이름. `color.primary` → `--t-color-primary`. 손 매핑을 두지 않는다(죽은 토큰 방지). */
export function tokenVarName(path: string): string {
  return `--t-${path.replace(/\./g, '-')}`
}

/** 조각 안에서 쓸 참조. `color.primary` → `var(--t-color-primary)`. */
export function tokenRef(path: string): string {
  return `var(${tokenVarName(path)})`
}

/** 토큰 전부를 CSS 변수 선언으로. 미리보기 뿌리에 얹으면 상속으로 조각 안까지 닿는다. */
export function tokenCss(tokens: TokenMap = DEFAULT_TOKENS): string {
  return Object.entries(tokens)
    .map(([path, value]) => `${tokenVarName(path)}: ${value};`)
    .join('\n')
}

/**
 * 뷰포트별 미리보기 폭. 화면을 세 벌 만드는 게 아니라 **같은 화면을 다른 폭으로 그리는 것**이다(§4).
 * 실제 기기 폭에서 흔한 값을 쓴다 — 정확한 기기 크기를 흉내 내는 게 목적이 아니라
 * "좁을 때 어떻게 되나"를 보는 게 목적이다.
 */
export const VIEWPORT_WIDTH: Record<Viewport, number> = {
  pc: 1160,
  tablet: 768,
  mobile: 390
}

export const VIEWPORT_LABEL: Record<Viewport, string> = {
  pc: 'PC',
  tablet: '태블릿',
  mobile: '모바일'
}
