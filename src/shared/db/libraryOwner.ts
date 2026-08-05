/**
 * 저장 쿼리·컬렉션 **라이브러리의 소속** 판정(순수).
 *
 * 원래 소속은 연결 하나뿐이었다. 그래서 두 가지가 안 됐다(2026-08-04 사용자 지적):
 *  ⑴ 같은 DB 의 DEV·STG·PROD 를 연결 셋으로 두면 같은 쿼리를 세 번 만들어야 했다 — 옮기거나
 *     맞출 길이 아예 없었다.
 *  ⑵ 연결을 지우면 그 라이브러리가 통째로 사라졌다(행은 남되 가리킬 연결이 없어 못 찾는다).
 *
 * 고친 방향: **쿼리는 접속 정보가 아니라 스키마에 대해 쓴다.** 그러니 소속은 연결이 아니라
 * 설계여야 한다. 다만 설계를 안 물린 연결도 Remote 는 그대로 돌아가므로(연결만으로 동작),
 * 그런 연결을 막지 않으려고 소속을 둘로 연다 — 설계 소속이 정본이고 연결 소속이 대비책이다.
 *
 * 두 벌로 두지 않은 이유: 이 앱은 이미 "설계 vs 실제"의 어긋남(drift)을 다루느라 화면을 셋
 * 쓰고 있다. 라이브러리까지 두 벌로 만들면 "어느 쪽이 맞나"가 하나 더 는다.
 */

export type LibraryOwner =
  /** 설계 소속 — 그 설계에 물린 연결들이 **같은 한 벌**을 함께 본다. */
  | { kind: 'design'; designId: string }
  /** 연결 소속 — 설계를 안 물린 연결의 자기 것. */
  | { kind: 'connection'; connectionId: string }

/** 화면이 "어느 라이브러리를 보는가"를 말하는 입력. 설계 화면은 설계만, 운영 화면은 연결만 준다. */
export interface LibraryScopeInput {
  connectionId?: string | null
  designId?: string | null
  /** 그 연결에 물린 설계들(`environments`). 연결로 물어볼 때만 쓰인다. */
  boundDesignIds?: readonly string[]
}

/**
 * 새로 만드는 것이 **어디에 붙는가**.
 *
 * 설계를 직접 준 화면(Design › Query·Collection)은 그 설계다. 연결로 물어본 화면(Remote)은
 * 그 연결에 물린 설계를 따라간다 — **딱 하나일 때만.** 둘 이상이면 어느 쪽 것인지 앱이 고를 수
 * 없으므로 연결 소속으로 남긴다(조용히 한쪽을 고르면 다른 설계 사람들 화면에 남의 쿼리가 뜬다).
 */
export function ownerFor(input: LibraryScopeInput): LibraryOwner | null {
  if (input.designId) return { kind: 'design', designId: input.designId }
  if (!input.connectionId) return null
  const bound = input.boundDesignIds ?? []
  if (bound.length === 1) return { kind: 'design', designId: bound[0] }
  return { kind: 'connection', connectionId: input.connectionId }
}

/**
 * 화면에 **보일** 것들의 소속. 만들 자리(`ownerFor`)와 다르다 — 연결로 볼 때는 설계 것과
 * 그 연결만의 것을 **함께** 보여야 한다. 안 그러면 설계를 물리는 순간 예전에 만든 쿼리들이
 * 화면에서 사라진다(지워지지도 않은 채).
 */
export function visibleOwners(input: LibraryScopeInput): LibraryOwner[] {
  if (input.designId) return [{ kind: 'design', designId: input.designId }]
  if (!input.connectionId) return []
  const owners: LibraryOwner[] = (input.boundDesignIds ?? []).map((designId) => ({
    kind: 'design' as const,
    designId
  }))
  owners.push({ kind: 'connection', connectionId: input.connectionId })
  return owners
}
