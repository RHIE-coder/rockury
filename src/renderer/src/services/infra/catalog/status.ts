import type { NodeStatus } from './types'

export interface StatusResult {
  /** 사전을 거친 값. 사전에 없으면 `unknown`. */
  status: NodeStatus
  /** 공급자가 준 원본 문자열. 화면에 함께 보인다. */
  raw: string
}

/**
 * 원본 상태 문자열 → 우리 다섯 칸.
 *
 * **사전에 없는 값은 '정상'이 아니라 '모름'이다.** 모르는 값을 정상으로 치면 지도가
 * 거짓말을 한다 — 죽은 것이 살아 있는 것처럼 보이는 쪽이 그 반대보다 훨씬 나쁘다.
 * 공급자마다 표기가 갈리므로(running / Running / RUNNING) 대소문자는 접어서 맞춘다.
 */
export function toStatus(
  raw: unknown,
  map: Readonly<Record<string, NodeStatus>> | undefined
): StatusResult {
  const text = raw === undefined || raw === null ? '' : String(raw)
  if (!text || !map) return { status: 'unknown', raw: text }

  const direct = map[text]
  if (direct) return { status: direct, raw: text }

  const folded = text.toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === folded) return { status: value, raw: text }
  }
  return { status: 'unknown', raw: text }
}
