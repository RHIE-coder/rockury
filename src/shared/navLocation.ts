/**
 * 화면 한 자리를 가리키는 값과 그 문자열 표기.
 *
 * 두 군데가 같은 표기를 읽고 쓴다 — 렌더러의 탭 하나가 이 자리를 들고, 새 창을 열 때
 * 메인이 이 문자열을 창 주소(`?nav=…`)에 실어 보낸다. 그래서 공용(@shared)에 둔다.
 *
 * 표기는 슬래시로 잇는다: `db/remote/collections`. 뷰가 없는 모듈은 두 토막(`ai/agents`).
 */

export interface NavLocation {
  serviceId: string
  moduleId: string
  /** 뷰가 없는 모듈(depth 2)이면 null. */
  viewId: string | null
}

/** id 로 허용하는 글자 — nav 트리의 id 는 전부 이 모양이다. 주소에 실리므로 좁게 잡는다. */
const ID = /^[A-Za-z0-9_-]+$/

export function encodeNavLocation(loc: NavLocation): string {
  const parts = [loc.serviceId, loc.moduleId]
  if (loc.viewId) parts.push(loc.viewId)
  return parts.join('/')
}

/**
 * 표기를 자리로 되푼다. 모양이 어긋나면 **null** — 주소는 사용자가 손댈 수 있는 값이라
 * 깨진 값으로 창을 열려다 빈 화면을 띄우느니 기본 자리로 떨어지는 편이 낫다.
 *
 * 모듈 id 는 빈 문자열도 받는다: nav 스토어가 "첫 모듈"을 그렇게 표현한다(`useNav` 주석).
 */
export function decodeNavLocation(raw: string | null | undefined): NavLocation | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  const parts = raw.split('/')
  if (parts.length < 2 || parts.length > 3) return null
  const [serviceId, moduleId, viewId] = parts
  if (!ID.test(serviceId)) return null
  if (moduleId !== '' && !ID.test(moduleId)) return null
  if (parts.length === 3 && !ID.test(viewId)) return null
  return { serviceId, moduleId, viewId: parts.length === 3 ? viewId : null }
}
