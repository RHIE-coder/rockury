import { useActiveDesign } from '../../designs/store'
import { useActiveTable, useDesignTables } from './store'
import { SqlCard } from './SqlCard'

/**
 * Design › Definition 의 SQL(DDL) 뷰 — 카드 본체는 운영부와 **같은 `SqlCard`** 다.
 *
 * @param labeled 이름·상태가 바로 위에서 이미 보이는 자리(상세 서랍·크게 보기 모달)면 false —
 *   머리를 되풀이하지 않고 단추만 남긴다. Remote 쪽 `SqlView` 와 같은 규칙.
 */
export function SqlForm({ labeled = true }: { labeled?: boolean }) {
  const table = useActiveTable()
  const design = useActiveDesign()
  const tables = useDesignTables()

  // 부모(DefinitionWorkspace)가 설계 선택·테이블 존재를 보장하지만 방어적으로 가드.
  if (!table || !design) return null

  return (
    <SqlCard
      table={table}
      // DDL 은 설계의 방언 그대로 — 방언은 선택지가 아니라 설계의 고정 속성.
      dialect={design.dialect}
      // 상세 서랍처럼 테이블 하나를 보는 자리에는 범위 토글을 두지 않는다.
      allTables={labeled ? tables : undefined}
      schemaName={design.name}
      labeled={labeled}
      badge={
        <span className="flex items-center gap-1.5 text-[11px] text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Table 폼과 동기화됨
        </span>
      }
    />
  )
}
