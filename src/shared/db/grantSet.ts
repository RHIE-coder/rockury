/**
 * 권한 세트의 단일 정본(§db-remote.grants.sets) — main 저장소·문장 생성기·렌더러가 함께 쓴다.
 * 세 곳에 사본을 두면 한쪽만 고쳐져 diff 판정과 화면 열이 조용히 어긋난다(리뷰 지적).
 */

/** 세트에 담을 수 있는 공통분모 권한(vendor AC-5). 현황 **표시**는 이 제한이 없다. */
export const SET_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const
export type SetPrivilege = (typeof SET_PRIVILEGES)[number]

export interface GrantSetItem {
  /** 테이블 이름 또는 `*` 와일드카드 패턴, 선택적 `스키마.` 한정(예: `shop.orders_*`). */
  pattern: string
  /** SET_PRIVILEGES 부분집합만 유효 — 저장·문장 생성이 각자 검증한다(보안 지적 H-1). */
  privileges: string[]
}

export interface GrantSetRecord {
  id: string
  name: string
  items: GrantSetItem[]
  createdAt: string
  updatedAt: string
}

const PRIV_SET = new Set<string>(SET_PRIVILEGES)

/**
 * 세트 항목 검증 — 통과하면 정규화된 사본, 아니면 null.
 * 권한 문자열은 화이트리스트 **정확 일치**만 허용한다: 이 값이 GRANT 문에 보간되므로
 * 자유 문자열을 들이면 저장소가 임의 SQL 실행의 배달로가 된다(보안 감사 H-1).
 */
export function sanitizeGrantSetItems(raw: unknown): GrantSetItem[] | null {
  if (!Array.isArray(raw)) return null
  const out: GrantSetItem[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const { pattern, privileges } = item as { pattern?: unknown; privileges?: unknown }
    if (typeof pattern !== 'string' || pattern.trim() === '') return null
    if (!Array.isArray(privileges) || privileges.length === 0) return null
    if (!privileges.every((p) => typeof p === 'string' && PRIV_SET.has(p))) return null
    out.push({ pattern: pattern.trim(), privileges: [...new Set(privileges as string[])] })
  }
  return out
}
