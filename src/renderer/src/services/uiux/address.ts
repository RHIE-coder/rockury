/**
 * 안정 주소 — INV-1·INV-2.
 *
 * 흐름의 도착점·규칙의 대상·핀 코멘트가 전부 이 주소에 걸린다. 그래서 주소는 **화면 이름이
 * 바뀌어도 흔들리지 않아야** 하고(그래서 `name` 이 아니라 `key` 를 잇는다), 되파싱했을 때
 * 층이 어긋나지 않아야 한다(그래서 조각에 점을 금지한다).
 */

/** 주소 조각 규칙: 소문자·숫자로 시작, 소문자 영숫자·하이픈·밑줄만. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

const SEPARATOR = '.'

/** 층 이름 — 조각 순서 그대로. 주소 깊이가 곧 층이다. */
export const ADDRESS_LEVELS = ['project', 'application', 'service', 'surface'] as const
export type AddressLevel = (typeof ADDRESS_LEVELS)[number]

export interface SpecAddress {
  project: string
  application?: string
  service?: string
  surface?: string
  /** 조각 수(1~4). 가장 깊은 층이 무엇인지는 `ADDRESS_LEVELS[depth - 1]`. */
  depth: 1 | 2 | 3 | 4
}

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key)
}

/**
 * 왜 이 key 를 쓸 수 없는지 사람 말로. 문제 없으면 null.
 * 화면이 그대로 보여줄 문구라 "패턴 불일치" 같은 말을 쓰지 않는다.
 */
export function keyProblem(key: string): string | null {
  if (key.length === 0) return '주소 조각이 비어 있어요.'
  if (key.includes(SEPARATOR)) return `점(${SEPARATOR})은 층을 가르는 기호라 이름에 넣을 수 없어요.`
  if (/\s/.test(key)) return '공백은 넣을 수 없어요.'
  if (/[A-Z]/.test(key)) return '소문자만 쓸 수 있어요.'
  if (!/^[a-z0-9]/.test(key)) return '소문자나 숫자로 시작해야 해요.'
  if (!KEY_PATTERN.test(key)) return '소문자·숫자와 하이픈(-)·밑줄(_)만 쓸 수 있어요.'
  return null
}

/**
 * 조각을 이어 주소를 만든다. 위에서부터 순서대로 주되 도중에 빈 칸을 둘 수 없다
 * (`project` 없이 `service` 만 있는 주소는 어느 앱 것인지 알 수 없다).
 * 규칙에 맞지 않는 조각이 있으면 던진다 — 잘못된 주소가 데이터에 남으면 나중에 조용히 안 걸린다.
 */
export function specAddress(...keys: string[]): string {
  if (keys.length === 0 || keys.length > ADDRESS_LEVELS.length) {
    throw new Error(`주소는 조각 1~${ADDRESS_LEVELS.length}개로 만듭니다 (받은 개수: ${keys.length})`)
  }
  keys.forEach((k, i) => {
    const problem = keyProblem(k)
    if (problem) throw new Error(`${ADDRESS_LEVELS[i]} 조각 '${k}' — ${problem}`)
  })
  return keys.join(SEPARATOR)
}

/** 주소를 층으로 되돌린다. 조각이 하나라도 규칙에 안 맞으면 주소가 아니므로 null. */
export function parseSpecAddress(addr: string): SpecAddress | null {
  const parts = addr.split(SEPARATOR)
  if (parts.length === 0 || parts.length > ADDRESS_LEVELS.length) return null
  if (!parts.every(isValidKey)) return null
  const [project, application, service, surface] = parts
  return { project, application, service, surface, depth: parts.length as SpecAddress['depth'] }
}

/**
 * 같은 부모 아래 겹치는 key(INV-1). 겹친 key 를 한 번씩 돌려준다(빈 배열이면 정상).
 * 저장 전에 부르는 용도라 "무엇이 겹쳤나"를 그대로 화면에 보일 수 있어야 한다.
 */
export function duplicateKeys(items: ReadonlyArray<{ key: string }>): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const { key } of items) {
    if (seen.has(key)) dup.add(key)
    seen.add(key)
  }
  return [...dup]
}
