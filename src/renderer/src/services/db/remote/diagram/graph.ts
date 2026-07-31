import { resolveRef, type TableRef } from '../../schemaRef'
import { classifyOutsideRefs, outsideNodeId, type OutsideKind } from '../outsideRef'
import type { FkAction, TableDef } from '../../workspaces/definition/types'

/**
 * Remote › Diagram(real, §ops-plan 2e)의 순수 그래프 변환.
 * introspection `TableDef[]` → ERD 노드/엣지. 렌더러(@xyflow) 타입에 묶이지 않도록
 * 자체 경량 타입으로 뽑는다(뷰가 xyflow Node/Edge 로 접는다) → node 환경 vitest 로 테스트 가능.
 * 입력→출력 결정적 → 테스트 의무 대상.
 *
 * 엣지는 FK 제약에서만 나온다: (스키마, refTable) 로 대상 노드를 찾고,
 * 카디널리티(1 vs N)는 FK 소스 컬럼 집합이 소스 테이블의 PK/UK 와 일치하는지로 판정한다.
 *
 * **범위 밖 대상**(안 켠 스키마 등)은 컬럼 없는 이름 카드(`outsideNodes`)로 그리고 그리로 선을
 * 잇는다 — 아무것도 안 그리면 관계가 있다는 사실 자체가 화면에서 사라진다(§db-remote.scope R3).
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
  /** 자기참조(대상이 자기 자신). */
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

/**
 * 범위 밖 대상 노드 — 컬럼이 없다(읽지 않았으니 모른다). 이름과 "왜 밖인지"만 든다.
 */
export interface ErdOutsideNode {
  id: string
  target: TableRef
  kind: OutsideKind
}

export interface Erd {
  nodes: ErdNode[]
  edges: ErdEdge[]
  /** 범위 밖 대상들 — `availableSchemas` 를 안 주면 비어 있다(예전 호출부 그대로 동작). */
  outsideNodes: ErdOutsideNode[]
}

/** 컬럼 id 집합을 정렬·직렬화해 비교 키로. (복합 키 순서 무관 일치 판정) */
function colKey(ids: string[]): string {
  return [...ids].sort().join('|')
}

/**
 * @param availableSchemas 이 연결에서 고를 수 있는 스키마 목록. 주면 범위 밖 대상을 카드로 그린다.
 *   안 주면 예전처럼 범위 밖 참조는 선 없이 사라진다(설계부 ERD 등 범위 개념이 없는 자리).
 */
export function buildErd(tables: TableDef[], availableSchemas?: readonly string[]): Erd {
  const nodes: ErdNode[] = tables.map((table) => ({ id: table.id, table }))
  const outside = availableSchemas ? classifyOutsideRefs(tables, availableSchemas) : []
  const outsideNodes: ErdOutsideNode[] = outside.map((r) => ({
    id: outsideNodeId(r.target),
    target: r.target,
    kind: r.kind
  }))
  // 어느 (테이블, 제약) 이 어느 밖 노드로 가는지 — 아래 엣지 만들기에서 되짚는다.
  const outsideBySource = new Map<string, string>()
  for (const r of outside)
    for (const src of r.sources) outsideBySource.set(`${src.table.id} ${src.constraintId}`, outsideNodeId(r.target))


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
      if (fk.kind !== 'fk') continue
      // 이름만으로 찾으면 다른 스키마의 동명 테이블로 선이 간다 — 실제로 없는 관계를 그린다.
      const targetTable = resolveRef(tables, table, fk)
      // 범위 밖이면 이름 카드로 잇는다. 카드조차 못 만들 때(범위 개념이 없는 화면)만 선을 버린다.
      const target = targetTable?.id ?? outsideBySource.get(`${table.id} ${fk.id}`)
      if (!target) continue

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
        selfRef: targetTable?.id === table.id,
        labelShiftY: 0,
        sourceRow: rowById.get(srcColIds[0] ?? '') ?? 0
      })
    }
  }
  assignLabelLanes(edges)
  return { nodes, edges, outsideNodes }
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
