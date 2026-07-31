import type { TableDef } from '../../workspaces/definition/types'
import type { Erd } from './graph'

/**
 * Remote ERD 검색·필터 순수 로직(§ops-plan 2e · 마감). 입력→출력 결정적 → 테스트 의무.
 */

/**
 * 검색어에 매칭되는 테이블 id 집합. 테이블명 또는 컬럼명 부분일치(대소문자 무시).
 * 빈 검색어면 빈 집합(= 검색 비활성).
 */
export function matchTables(tables: TableDef[], query: string): Set<string> {
  const q = query.trim().toLowerCase()
  const out = new Set<string>()
  if (!q) return out
  for (const t of tables) {
    if (t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))) {
      out.add(t.id)
    }
  }
  return out
}

/** 관계(엣지)가 하나도 없는 고립 테이블 id 집합. */
export function isolatedTableIds(erd: Erd): Set<string> {
  const connected = new Set<string>()
  for (const e of erd.edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  return new Set(erd.nodes.filter((n) => !connected.has(n.id)).map((n) => n.id))
}
