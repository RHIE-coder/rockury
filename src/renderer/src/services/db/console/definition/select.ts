import type { TableDef } from '../../workspaces/definition/types'

/**
 * Console › Definition 사이드바의 순수 선택 로직(입력→출력 결정적 → 테스트 의무).
 * 상태는 뷰의 로컬 state — 읽기 전용이라 스토어 불필요.
 */

/** 테이블명 또는 컬럼명에 질의가 포함되면 매칭(대소문자 무시). 빈 질의는 전체. 원래 순서 보존. */
export function filterTables(tables: TableDef[], query: string): TableDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return tables
  return tables.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.columns.some((c) => c.name.toLowerCase().includes(q))
  )
}

/**
 * 활성 테이블 해석 — id 로 찾되 없으면(재조회로 스키마가 바뀌어 id 가 사라졌을 때 등) 첫 테이블로 폴백.
 * 목록이 비면 undefined.
 */
export function resolveActiveTable(tables: TableDef[], activeId: string | null): TableDef | undefined {
  if (activeId) {
    const hit = tables.find((t) => t.id === activeId)
    if (hit) return hit
  }
  return tables[0]
}
