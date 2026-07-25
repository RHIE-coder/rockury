import type { ConstraintKind, TableDef } from '../workspaces/definition/types'
import { fkRefText } from '../workspaces/definition/fkPolicy'

/**
 * Constraint 탭(읽기 전용, §ops 향상 — 이미지 #5)의 순수 집계 유틸.
 * introspection TableDef[] → 전역 제약 평탄 목록 + 종류별 개수 + 필터.
 * 키 종류는 PK/FK/UK/IDX/CHECK 텍스트로만 표기(사용자 규칙). 순수 함수 → 테스트 의무 대상.
 */
export type KindFilter = 'ALL' | ConstraintKind
export const KIND_FILTERS: KindFilter[] = ['ALL', 'pk', 'fk', 'uk', 'idx', 'check']

export interface FlatConstraint {
  id: string
  table: string
  kind: ConstraintKind
  name: string
  /** 참여 컬럼명(순서 유지). */
  columns: string[]
  /** fk 전용 — 좁은 목록용 짧은 참조 표기 `→ users (id)`(없으면 undefined). */
  refLabel?: string
  /** fk 전용 — 정책까지 붙인 표기(폭이 있는 표에서 사용). */
  refDetail?: string
}

/** 전 테이블의 제약을 평탄화. 컬럼 id 는 컬럼명으로 해석. 정렬: 테이블→종류→이름. */
export function flattenConstraints(tables: TableDef[]): FlatConstraint[] {
  const out: FlatConstraint[] = []
  for (const t of tables) {
    const nameById = new Map(t.columns.map((c) => [c.id, c.name]))
    for (const con of t.constraints) {
      out.push({
        id: `${t.name}::${con.name}`,
        table: t.name,
        kind: con.kind,
        name: con.name,
        columns: con.columns.map((ref) => nameById.get(ref.columnId) ?? ref.columnId),
        refLabel: fkRefText(con),
        refDetail: fkRefText(con, true)
      })
    }
  }
  return out.sort(
    (a, b) => a.table.localeCompare(b.table) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  )
}

/** ALL + 각 종류의 개수. */
export function countByKind(list: FlatConstraint[]): Record<KindFilter, number> {
  const counts: Record<KindFilter, number> = { ALL: list.length, pk: 0, fk: 0, uk: 0, idx: 0, check: 0 }
  for (const c of list) counts[c.kind] += 1
  return counts
}

/** 종류 필터. ALL 이면 전부. */
export function filterByKind(list: FlatConstraint[], f: KindFilter): FlatConstraint[] {
  return f === 'ALL' ? list : list.filter((c) => c.kind === f)
}

/** 테이블별로 묶은 제약 그룹. */
export interface ConstraintGroup {
  table: string
  constraints: FlatConstraint[]
}

/**
 * 제약을 **테이블별 그룹**으로 묶는다 — "테이블(Header) > 그 테이블 제약들" 형태로 보이기 위함.
 * 입력은 이미 테이블→종류→이름 순 정렬(flattenConstraints)이라 그룹·그룹 내 순서가 그대로 유지된다.
 * 순수 함수 → 테스트 의무.
 */
export function groupConstraintsByTable(list: FlatConstraint[]): ConstraintGroup[] {
  const groups: ConstraintGroup[] = []
  const byTable = new Map<string, ConstraintGroup>()
  for (const c of list) {
    let g = byTable.get(c.table)
    if (!g) {
      g = { table: c.table, constraints: [] }
      byTable.set(c.table, g)
      groups.push(g)
    }
    g.constraints.push(c)
  }
  return groups
}
