/**
 * 버전 번호 유틸 — `v0.3.14` 형태(semver 유사)를 파싱·증가한다.
 * 입력→출력이 결정적인 순수 함수(테스트 의무). 운영 DB 가져오기·버전 컷에서 다음 번호를 제안한다.
 * src/shared: 렌더러(가져오기)와 메인(MCP create_version)이 같은 번호 규칙을 써야 해서 공용 —
 * 프로세스별 사본을 두면 형식 규칙이 어긋날 때 에이전트만 거부되는 드리프트가 생긴다.
 */
export type BumpLevel = 'major' | 'minor' | 'patch'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

// v 접두는 선택. minor/patch 는 생략 가능(0 으로 채움). 세 자리 초과 꼬리는 불허(오탈자 방지).
const RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/

export function parseVersion(input: string): ParsedVersion | null {
  const m = RE.exec((input ?? '').trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: m[2] === undefined ? 0 : Number(m[2]),
    patch: m[3] === undefined ? 0 : Number(m[3])
  }
}

export function formatVersion(v: ParsedVersion): string {
  return `v${v.major}.${v.minor}.${v.patch}`
}

/** 첫 버전(설계에 버전이 없거나 새 설계일 때)의 기본 제안. */
export const FIRST_VERSION = 'v0.1.0'

/**
 * 다음 버전 번호 제안. current 가 없거나(첫 컷) 파싱 불가하면 FIRST_VERSION.
 * level 기본은 patch — 운영 드리프트 흡수는 대개 소규모라 기존 seed 서사(v0.3.13→v0.3.14)와 일치.
 */
export function nextVersion(current: string | null | undefined, level: BumpLevel = 'patch'): string {
  if (!current) return FIRST_VERSION
  const p = parseVersion(current)
  if (!p) return FIRST_VERSION
  if (level === 'major') return formatVersion({ major: p.major + 1, minor: 0, patch: 0 })
  if (level === 'minor') return formatVersion({ major: p.major, minor: p.minor + 1, patch: 0 })
  return formatVersion({ major: p.major, minor: p.minor, patch: p.patch + 1 })
}
