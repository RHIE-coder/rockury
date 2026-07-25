import type { TableDef } from './workspaces/definition/types'

/**
 * 테이블 목록 패널의 공용 순수 로직 — 검색 필터 + 테이블/뷰 가르기.
 * Definition·Diagram·Data 어느 화면이든 같은 규칙으로 목록을 만들도록 여기 한 곳에 둔다
 * (입력→출력 결정적 → 테스트 의무).
 */

/** 테이블명 또는 컬럼명에 질의가 포함되면 매칭(대소문자 무시). 빈 질의는 전체. 원래 순서 보존. */
export function filterTables(tables: TableDef[], query: string): TableDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return tables
  return tables.filter(
    (t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))
  )
}

export interface TableListGroups {
  /** 일반 테이블(뷰 아님). */
  tables: TableDef[]
  /** 뷰(view/matview). */
  views: TableDef[]
  /** 검색 전 전체 개수 — "테이블 없음"과 "검색 결과 없음"을 가르는 데 쓴다. */
  total: number
  /** 검색 후 개수(테이블 + 뷰). */
  shown: number
}

/** 검색을 적용한 뒤 테이블/뷰로 가른다. 각 묶음의 원래 순서는 유지. */
export function groupTablesForList(tables: TableDef[], query = ''): TableListGroups {
  const shown = filterTables(tables, query)
  return {
    tables: shown.filter((t) => !t.isView),
    views: shown.filter((t) => t.isView),
    total: tables.length,
    shown: shown.length
  }
}
