import type { Catalog } from './types'

/** 참조가 깨졌을 때 대신 그리는 phosphor 아이콘. 그림이 깨지는 것보다 낫다. */
export const FALLBACK_ICON = 'cube'

export interface IconRef {
  kind: 'phosphor' | 'pack' | 'data'
  /** phosphor 아이콘 이름, 팩 안의 이름, 또는 data URI 원문. */
  name: string
  /** `pack:` 일 때의 팩 이름. */
  pack?: string
  /** 참조가 깨져 기본 아이콘으로 떨어졌을 때의 사유. 화면은 조용히 넘기고 로그만 남긴다. */
  warning?: string
}

const fallback = (warning: string): IconRef => ({ kind: 'phosphor', name: FALLBACK_ICON, warning })

/**
 * 아이콘 참조 문자열 하나를 푼다 — `phosphor:<이름>` · `pack:<팩>/<이름>` · `data:…`.
 *
 * 참조 문법을 문자열 하나로 통일해 둔 이유: 나중에 팩이 늘어도 **카탈로그 형식이 안 바뀐다.**
 * 그리고 **절대 던지지 않는다** — 카탈로그 하나가 깨졌다고 다이어그램 전체가 못 그려지면 안 된다.
 */
export function parseIconRef(ref: string): IconRef {
  const text = (ref ?? '').trim()
  if (!text) return fallback('아이콘 참조가 비어 있습니다')

  const at = text.indexOf(':')
  if (at <= 0) return fallback(`접두어가 없는 아이콘 참조: '${text}'`)

  const prefix = text.slice(0, at)
  const rest = text.slice(at + 1)

  if (prefix === 'phosphor') {
    if (!rest.trim()) return fallback(`phosphor 아이콘 이름이 비었습니다: '${text}'`)
    return { kind: 'phosphor', name: rest.trim() }
  }
  if (prefix === 'pack') {
    const slash = rest.indexOf('/')
    if (slash <= 0 || !rest.slice(slash + 1).trim()) {
      return fallback(`팩 아이콘 참조는 'pack:<팩>/<이름>' 이어야 합니다: '${text}'`)
    }
    return { kind: 'pack', pack: rest.slice(0, slash), name: rest.slice(slash + 1).trim() }
  }
  if (prefix === 'data') return { kind: 'data', name: text }

  return fallback(`모르는 아이콘 접두어 '${prefix}' — '${text}'`)
}

/**
 * 카탈로그·프리셋을 훑어 **실제 쓰인 phosphor 아이콘 이름만** 모은다.
 *
 * 왜 필요한가: 아이콘 이름이 데이터(문자열)라 빌드 도구가 무엇이 쓰이는지 정적으로 못 읽는다 →
 * 안 쓰는 코드를 털어내는 최적화가 통하지 않아 아이콘 세트 전체(수천 개)가 번들에 들어간다.
 * 이 수집기가 그 빈자리를 메운다. 참조가 깨진 것(기본 아이콘으로 떨어진 것)은 모으지 않는다.
 */
export function collectIconNames(
  catalogs: Catalog[],
  opts: { includeFallback?: boolean } = {}
): string[] {
  const names = new Set<string>()
  if (opts.includeFallback) names.add(FALLBACK_ICON)
  for (const c of catalogs) {
    for (const t of c.nodeTypes) {
      const ref = parseIconRef(t.icon)
      if (ref.kind === 'phosphor' && !ref.warning) names.add(ref.name)
    }
  }
  return [...names].sort()
}
