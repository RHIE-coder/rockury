/**
 * 프로젝트 범위 — "지금 보는 모든 것이 무엇에 속하나".
 *
 * 셸의 셀렉터 하나가 이 값을 들고, 다섯 서비스의 목록이 함께 좁혀진다. 레일의 서비스가 아닌
 * 이유: 프로젝트는 하는 일이 아니라 범위라, 화면으로 만들면 그 화면을 떠나야 효력이 생긴다.
 */
export type ProjectScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'one'; projectId: string }

export const SCOPE_ALL: ProjectScope = { kind: 'all' }
export const SCOPE_NONE: ProjectScope = { kind: 'none' }

export function oneProject(projectId: string): ProjectScope {
  return { kind: 'one', projectId }
}

/**
 * 무소속(소속 칸이 빈 것)을 어떻게 볼지 — **여기서만 두 갈래가 갈린다**.
 *
 * - `strict` — 설계류(DB 설계·API 명세·인프라 설계본). 그 프로젝트의 산출물이라
 *   프로젝트를 고르면 정체 모를 무소속이 섞이면 안 된다.
 * - `shared` — 접속류(DB 접속·클라우드 계정·미들웨어). 쓰는 도구라 어느 프로젝트에서나
 *   보여야 한다. 여기서 숨기면 같은 로컬 접속을 프로젝트마다 다시 등록하게 된다.
 *
 * 다른 프로젝트 것이 숨는 건 두 갈래가 같다.
 */
export type UnassignedRule = 'strict' | 'shared'

/** 소속 칸을 가진 것의 최소 모양. 저장소는 NULL, 폼은 빈 문자열, 옛 행은 칸 자체가 없다. */
export interface Scoped {
  projectId?: string | null
}

/** 셀렉터가 다루는 특수 옵션 id — 프로젝트 id 와 섞이지 않게 양옆에 밑줄을 둘렀다. */
export const OPTION_ALL = '__all__'
export const OPTION_NONE = '__none__'

export function inScope(item: Scoped, scope: ProjectScope, rule: UnassignedRule): boolean {
  if (scope.kind === 'all') return true

  const owner = item.projectId
  const unassigned = owner === null || owner === undefined || owner === ''

  if (unassigned) {
    // 무소속이 보이는 자리는 둘 — '프로젝트 없음' 이거나, 공용으로 다루는 접속류이거나.
    return scope.kind === 'none' || rule === 'shared'
  }
  return scope.kind === 'one' && owner === scope.projectId
}

/** 목록을 범위로 거른다. 순서는 그대로 둔다 — 거르기는 정렬이 아니다. */
export function filterByScope<T extends Scoped>(
  items: readonly T[],
  scope: ProjectScope,
  rule: UnassignedRule
): T[] {
  if (scope.kind === 'all') return [...items]
  return items.filter((i) => inScope(i, scope, rule))
}

export function scopeToOptionId(scope: ProjectScope): string {
  if (scope.kind === 'all') return OPTION_ALL
  if (scope.kind === 'none') return OPTION_NONE
  return scope.projectId
}

/** 셀렉터가 고른 id 를 범위로 편다. 빈 값은 전체 — 켜자마자 목록이 비어 보이면 안 된다. */
export function scopeFromOptionId(id: string | null | undefined): ProjectScope {
  if (!id || id === OPTION_ALL) return SCOPE_ALL
  if (id === OPTION_NONE) return SCOPE_NONE
  return oneProject(id)
}
