import type { FkAction, TableDef } from '../../workspaces/definition/types'
import { fkRefLabel } from '../constraintsView'

/**
 * Console › Diagram(real, §ops-plan 2e)의 순수 그래프 변환.
 * introspection `TableDef[]` → ERD 노드/엣지. 렌더러(@xyflow) 타입에 묶이지 않도록
 * 자체 경량 타입으로 뽑는다(뷰가 xyflow Node/Edge 로 접는다) → node 환경 vitest 로 테스트 가능.
 * 입력→출력 결정적 → 테스트 의무 대상.
 *
 * 엣지는 FK 제약에서만 나온다: refTable 이름으로 대상 노드를 찾고(같은 스키마에 있을 때만),
 * 카디널리티(1 vs N)는 FK 소스 컬럼 집합이 소스 테이블의 PK/UK 와 일치하는지로 판정한다.
 */

/** ERD 노드 하나 — 테이블 1:1. id 는 TableDef.id(`t:<name>`) 그대로 쓴다. */
export interface ErdNode {
  id: string
  table: TableDef
}

/** ERD 엣지 하나 — FK 관계 1:1. source=FK 보유 테이블, target=참조 테이블. */
export interface ErdEdge {
  id: string
  source: string
  target: string
  /** FK 소스 컬럼(핸들 앵커용) — 복합 FK 면 첫 컬럼의 id. */
  sourceColumnId: string
  /** `col → refCol` 표기(컬럼명). */
  label: string
  /** FK 컬럼 중 하나라도 NULL 허용이면 true(0..N / 0..1 표기). */
  nullable: boolean
  /** 소스 FK 컬럼 집합이 PK/UK 와 일치 → 1:1(one) 마커, 아니면 N(many). */
  isUnique: boolean
  onDelete?: FkAction
  onUpdate?: FkAction
  /** 자기참조(refTable === 자기 테이블). */
  selfRef: boolean
}

export interface Erd {
  nodes: ErdNode[]
  edges: ErdEdge[]
}

/** 컬럼 id 집합을 정렬·직렬화해 비교 키로. (복합 키 순서 무관 일치 판정) */
function colKey(ids: string[]): string {
  return [...ids].sort().join('|')
}

export function buildErd(tables: TableDef[]): Erd {
  const nodes: ErdNode[] = tables.map((table) => ({ id: table.id, table }))

  // 이름 → 노드 id (refTable 이 이름이므로). 같은 스키마에 없는 참조는 엣지를 만들지 않는다.
  const idByName = new Map(tables.map((t) => [t.name, t.id]))

  const edges: ErdEdge[] = []
  for (const table of tables) {
    // 소스 테이블의 PK/UK 컬럼 집합들(1:1 판정용) + 컬럼 id→이름.
    const uniqueKeys = new Set(
      table.constraints
        .filter((c) => c.kind === 'pk' || c.kind === 'uk')
        .map((c) => colKey(c.columns.map((r) => r.columnId)))
    )
    const colName = new Map(table.columns.map((c) => [c.id, c.name]))
    const nullableById = new Map(table.columns.map((c) => [c.id, c.nullable]))

    for (const fk of table.constraints) {
      if (fk.kind !== 'fk' || !fk.refTable) continue
      const target = idByName.get(fk.refTable)
      if (!target) continue // 다른 스키마/누락 참조 — 스킵

      const srcColIds = fk.columns.map((r) => r.columnId)
      const srcColNames = srcColIds.map((id) => colName.get(id) ?? id)
      const refCols = fk.refColumns ?? []
      const label = `${srcColNames.join(', ')} → ${refCols.join(', ')}`

      edges.push({
        id: `${table.id}::${fk.name}`,
        source: table.id,
        target,
        sourceColumnId: srcColIds[0] ?? '',
        label,
        nullable: srcColIds.some((id) => nullableById.get(id) ?? true),
        isUnique: uniqueKeys.has(colKey(srcColIds)),
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
        selfRef: fk.refTable === table.name
      })
    }
  }
  return { nodes, edges }
}

/** 엣지 라벨(툴팁/목록용) — constraintsView 의 fkRefLabel 재사용 위임. */
export { fkRefLabel }
