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

/**
 * 저장 규격 판정 — 정규형(`v0.1.0`)만 참이다.
 * 컷 입구가 셋(버전 컷 모달·운영 DB 가져오기·MCP `create_version`)이라 규칙을 각자 갖게 두면
 * 한 입구만 느슨해도 형식이 어긋난 번호가 섞인다. 규칙은 여기 하나뿐이고, 사람이 적은
 * `0.2`·`v2` 는 부르는 쪽이 parseVersion→formatVersion 으로 고쳐 통과시킨다.
 */
export function isVersionNumber(input: string): boolean {
  const p = parseVersion(input)
  return !!p && formatVersion(p) === input
}

/**
 * 두 번호의 순서 — 자리별로 견준다(음수면 a 가 앞). 파싱 불가는 `v0.0.0` 으로 본다.
 * 견줄 목록을 고를 때는 `highestVersion` 을 쓴다 — 거기서 정규형만 남긴다.
 */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a) ?? { major: 0, minor: 0, patch: 0 }
  const pb = parseVersion(b) ?? { major: 0, minor: 0, patch: 0 }
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch
}

/**
 * 목록에서 가장 높은 번호. 없으면 null.
 *
 * **정규형이 아닌 번호는 뺀다.** 형식 관문이 서기 전에 들어온 옛 번호(`2.0` 같은)가 한 줄
 * 섞여 있을 수 있는데, 화면의 정렬도 그런 줄을 `v0.0.0` 으로 밀어 둔다. 여기서만 느슨하게
 * 읽으면 "화면은 v0.1.0 이 최신이라는데 컷은 v2.0.0 보다 높으라고 거절하는" 상태가 된다 —
 * 그러면 그 설계는 아무 번호로도 컷할 수 없다.
 */
export function highestVersion(numbers: string[]): string | null {
  const usable = numbers.filter(isVersionNumber)
  if (!usable.length) return null
  return usable.reduce((top, n) => (compareVersion(n, top) > 0 ? n : top))
}
