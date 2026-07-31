import type { DialectId } from '../../dialects'
import { SqlCard } from '../../workspaces/definition/SqlCard'
import type { TableDef } from '../../workspaces/definition/types'

/**
 * Remote › Definition 의 SQL(DDL) 읽기 전용 뷰 — 카드 본체는 설계부와 **같은 `SqlCard`** 다.
 * 정본: §db-remote.definition.sql. Definition 화면과 **Diagram 상세보기 서랍**이 이것을 함께 쓴다
 * (서랍에서 DDL 이 다르게 보이면 같은 것을 두 번 만든 셈이다).
 */
export function SqlView({
  table,
  dialect,
  labeled = true,
  allTables,
  schemaName
}: {
  table: TableDef
  dialect: DialectId
  /** 이름·출처가 바로 위에서 이미 보이는 자리(상세 서랍)면 false. */
  labeled?: boolean
  /** 있으면 범위 토글(이 테이블 / 전체 스키마)이 생긴다. */
  allTables?: TableDef[]
  /** 전체 스크립트를 저장할 때의 파일 이름 — 연결 이름. */
  schemaName?: string
}) {
  return (
    <SqlCard
      table={table}
      dialect={dialect}
      allTables={allTables}
      schemaName={schemaName}
      labeled={labeled}
      badge={
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="size-1.5 rounded-full bg-muted/60" />
          실 DB 역설계 · 읽기 전용
        </span>
      }
    />
  )
}
