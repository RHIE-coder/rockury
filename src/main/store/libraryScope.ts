import { ownerFor, visibleOwners, type LibraryOwner } from '../../shared/db/libraryOwner'
import { listBindingsByConnection } from './environments'

/**
 * 라이브러리 스코프를 SQL 로 옮기는 자리 — **판정은 여기 없다**(`@shared/db/libraryOwner` 가
 * 순수 함수로 든다). 여기는 그 판정에 필요한 것(연결에 물린 설계)을 저장소에서 읽어다 주고,
 * 나온 소속을 WHERE 절과 INSERT 값으로 바꾸는 일만 한다.
 */

/** 화면이 준 것(연결 또는 설계)에 **그 연결에 물린 설계**를 채워 넣는다. */
function fill(input: LibraryScope): {
  connectionId?: string | null
  designId?: string | null
  boundDesignIds: string[]
} {
  const bound =
    input.connectionId && !input.designId
      ? [...new Set(listBindingsByConnection(input.connectionId).map((b) => b.designId))]
      : []
  return { ...input, boundDesignIds: bound }
}

/** 화면이 "어느 라이브러리인가"를 말하는 입력. 설계 화면은 설계만, 운영 화면은 연결만 준다. */
export interface LibraryScope {
  connectionId?: string | null
  designId?: string | null
}

/** 새로 만드는 것이 붙을 자리. 붙일 데가 없으면 던진다 — 주인 없는 행이 생기면 못 찾는다. */
export function ownerColumns(scope: LibraryScope): { connectionId: string; designId: string } {
  const owner = ownerFor(fill(scope))
  if (!owner) throw new Error('라이브러리를 담을 설계도 연결도 없습니다')
  return owner.kind === 'design'
    ? { connectionId: '', designId: owner.designId }
    : { connectionId: owner.connectionId, designId: '' }
}

/**
 * 보일 것들의 WHERE 절. 볼 것이 하나도 없으면 **아무 행도 안 맞는 절**을 준다 —
 * 빈 절(`''`)을 돌려주면 호출하는 쪽이 조건 없이 전부 긁어 온다.
 */
export function ownerWhere(scope: LibraryScope): { sql: string; params: string[] } {
  const owners: LibraryOwner[] = visibleOwners(fill(scope))
  if (owners.length === 0) return { sql: '0', params: [] }
  const parts: string[] = []
  const params: string[] = []
  for (const o of owners) {
    if (o.kind === 'design') {
      parts.push('design_id = ?')
      params.push(o.designId)
    } else {
      // 설계 칸이 빈 행만 연결 소속이다 — 이사 간 행은 옛 connection_id 가 지워지지만,
      // 그 가드가 없으면 앞으로 생길 어긋난 행 하나가 목록에 두 번 뜬다.
      parts.push(`(design_id = '' AND connection_id = ?)`)
      params.push(o.connectionId)
    }
  }
  return { sql: `(${parts.join(' OR ')})`, params }
}
