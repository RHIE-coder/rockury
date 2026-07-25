import type { TableDef } from '../../workspaces/definition/types'

/**
 * Console › Definition 사이드바의 순수 선택 로직(입력→출력 결정적 → 테스트 의무).
 * 상태는 뷰의 로컬 state — 읽기 전용이라 스토어 불필요.
 * (목록 검색·테이블/뷰 가르기는 화면 공통이라 `db/tableList.ts` 로 옮겼다.)
 */

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
