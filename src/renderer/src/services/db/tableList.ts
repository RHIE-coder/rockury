import { groupBySchema, hasMultipleSchemas } from './schemaRef'
import type { TableDef } from './workspaces/definition/types'

/**
 * 테이블 목록 패널의 공용 순수 로직 — 검색 필터 + 스키마 묶기 + 테이블/뷰 가르기.
 * Definition·Diagram·Data 어느 화면이든 같은 규칙으로 목록을 만들도록 여기 한 곳에 둔다
 * (입력→출력 결정적 → 테스트 의무).
 */

/**
 * 테이블명·컬럼명·**스키마명**에 질의가 포함되면 매칭(대소문자 무시). 빈 질의는 전체, 원래 순서 보존.
 * 스키마도 훑는 이유: 범위를 켜면 목록이 수십 개가 되는데, 그때 제일 먼저 하고 싶은 일이
 * "auth 것만 보기"다. 스키마를 못 훑으면 그러려고 범위를 껐다 켜야 한다.
 */
export function filterTables(tables: TableDef[], query: string): TableDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return tables
  return tables.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      (t.schema ?? '').toLowerCase().includes(q) ||
      t.columns.some((c) => c.name.toLowerCase().includes(q))
  )
}

/** 스키마 하나 안의 테이블·뷰 묶음. */
export interface SchemaGroup {
  /** 스키마 이름. 스키마를 안 쓰는 목록이면 빈 문자열. */
  schema: string
  tables: TableDef[]
  views: TableDef[]
}

export interface TableListGroups {
  /**
   * 스키마별 묶음(스키마 이름순). 스키마가 하나뿐이면 묶음도 하나 —
   * 화면은 `multiSchema` 가 false 면 스키마 머리를 안 그린다.
   */
  groups: SchemaGroup[]
  /** 목록에 스키마가 둘 이상 섞여 있나 — 스키마 머리를 그릴지의 기준. */
  multiSchema: boolean
  /** 검색 전 전체 개수 — "테이블 없음"과 "검색 결과 없음"을 가르는 데 쓴다. */
  total: number
  /** 검색 후 개수(테이블 + 뷰). */
  shown: number
}

/**
 * 검색 → 스키마별 묶기 → 각 묶음 안에서 테이블/뷰 가르기. 각 단계의 원래 순서는 유지.
 *
 * 스키마로 먼저 묶는 이유: 범위(scope)를 켜면 여러 스키마가 한 목록에 섞이는데, 표시가 없으면
 * `card`(entity)와 `cards`(public)가 아무 구분 없이 나란히 서서 **어느 쪽인지 알 수 없다**
 * (2026-07-30 사용자 실측: "내가 어떻게 이걸 구분하냐"). 정렬만 스키마순이고 머리가 없으면
 * 오히려 이름순이 깨진 것처럼 보여 더 나쁘다.
 */
export function groupTablesForList(tables: TableDef[], query = ''): TableListGroups {
  const shown = filterTables(tables, query)
  return {
    groups: groupBySchema(shown).map((g) => ({
      schema: g.schema,
      tables: g.tables.filter((t) => !t.isView),
      views: g.tables.filter((t) => t.isView)
    })),
    // 판정은 **검색 결과가 아니라 전체 목록** 기준이다 — 검색으로 한 스키마만 남았다고
    // 머리가 사라지면 지금 보는 것이 어느 스키마인지 알 수 없어진다.
    multiSchema: hasMultipleSchemas(tables),
    total: tables.length,
    shown: shown.length
  }
}
