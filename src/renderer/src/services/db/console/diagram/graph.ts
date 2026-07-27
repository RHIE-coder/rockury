import type { FkAction, TableDef } from '../../workspaces/definition/types'

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
  /**
   * 라벨 카드의 세로 보정(px, ±). 라벨은 소스(FK 컬럼 행) 옆에 붙는데 카드는 컬럼 행(22px)보다
   * 높아서, FK 컬럼이 서로 가까운 행에 있으면 카드끼리 겹친다 → 그 무리만 위아래로 벌린다.
   * 뷰가 이 값만큼 라벨 Y 를 옮긴다. 자기참조는 별도 배치이므로 항상 0.
   */
  labelShiftY: number
  /** 소스 FK 컬럼의 행 번호(0-based) — 라벨 앵커 Y 계산용(겹침 판정). */
  sourceRow: number
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
    const rowById = new Map(table.columns.map((c, i) => [c.id, i]))

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
        selfRef: fk.refTable === table.name,
        labelShiftY: 0,
        sourceRow: rowById.get(srcColIds[0] ?? '') ?? 0
      })
    }
  }
  assignLabelLanes(edges)
  return { nodes, edges }
}

/** 컬럼 행 높이(px) — TableErdNode 렌더/estimateNodeSize 의 ROW 와 같은 값. */
const ROW_H = 22
/** 라벨 카드 한 장이 차지하는 세로 레인(2줄 카드 ≈ 36px + 숨 틈). */
export const LABEL_LANE_H = 42

/**
 * 라벨 겹침 완화(순수) — 각 엣지에 세로 보정(px)을 부여한다.
 * 라벨은 소스 FK 컬럼 행 옆에 붙는데, 카드가 컬럼 행(22px)보다 높아 **FK 컬럼이 가까운 행끼리**
 * (같은 컬럼 포함) 카드가 겹친다 → 같은 테이블에서 나가는 라벨들을 앵커 Y 순으로 훑어
 * LABEL_LANE_H 안에 몰린 무리를 하나로 묶고, 그 무리를 원래 중심에 맞춰 균등 분산한다.
 * 자기참조는 노드 위 루프에 얹히므로 제외. 엣지 순서를 따르므로 결정적 → 테스트 의무.
 */
function assignLabelLanes(edges: ErdEdge[]): void {
  const byTable = new Map<string, ErdEdge[]>()
  for (const e of edges) {
    if (e.selfRef) continue
    const arr = byTable.get(e.source) ?? []
    arr.push(e)
    byTable.set(e.source, arr)
  }

  for (const group of byTable.values()) {
    if (group.length < 2) continue
    // 앵커 Y(행 × 행높이) 오름차순. 같은 행이면 엣지 생성 순서 유지(안정 정렬).
    const sorted = group
      .map((e, i) => ({ e, y: e.sourceRow * ROW_H, i }))
      .sort((a, b) => a.y - b.y || a.i - b.i)

    // 앞 라벨과 한 레인 안에 겹치면 같은 무리로 이어 붙인다.
    let cluster: typeof sorted = []
    const flush = (): void => {
      if (cluster.length < 2) {
        cluster = []
        return
      }
      // 무리의 원래 중심을 유지한 채 레인 간격으로 균등 배치(위/아래로 반씩 벌어진다).
      const center = cluster.reduce((sum, c) => sum + c.y, 0) / cluster.length
      cluster.forEach((c, k) => {
        const target = center + (k - (cluster.length - 1) / 2) * LABEL_LANE_H
        c.e.labelShiftY = Math.round(target - c.y)
      })
      cluster = []
    }
    for (const cur of sorted) {
      const prev = cluster[cluster.length - 1]
      if (prev && cur.y - prev.y >= LABEL_LANE_H) flush()
      cluster.push(cur)
    }
    flush()
  }
}
