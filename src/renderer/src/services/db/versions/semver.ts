/** 버전 번호 유틸 — `vMAJOR.MINOR.PATCH` 형식, 설계별 단조 증가 보장에 사용. */
export type Bump = 'patch' | 'minor' | 'major'

const RE = /^v(\d+)\.(\d+)\.(\d+)$/

export function parseVer(s: string): [number, number, number] | null {
  const m = RE.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVer(a: string, b: string): number {
  const pa = parseVer(a) ?? [0, 0, 0]
  const pb = parseVer(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/** 목록에서 가장 높은 버전 번호. 없으면 null. */
export function latestVer(nums: string[]): string | null {
  if (!nums.length) return null
  return [...nums].sort(compareVer)[nums.length - 1]
}

export function bumpVer(base: string, type: Bump): string {
  const [maj, min, pat] = parseVer(base) ?? [0, 0, 0]
  if (type === 'major') return `v${maj + 1}.0.0`
  if (type === 'minor') return `v${maj}.${min + 1}.0`
  return `v${maj}.${min}.${pat + 1}`
}
