import type { Constraint, TableDef } from '../definition/types'

/**
 * Studio ERD 편집: 관계선을 끌었을 때(source 컬럼 → target 테이블) 만들 FK 제약 패치를 계산하는
 * 순수 로직. 참조 컬럼 기본값은 대상 테이블의 PK 컬럼(없으면 첫 컬럼). 입력→출력 결정적 → 테스트 의무.
 */

/** 대상 테이블의 기본 참조 컬럼명 — PK 제약의 컬럼(순서 유지), 없으면 첫 컬럼, 그것도 없으면 빈 배열. */
export function defaultRefColumns(target: TableDef): string[] {
  const pk = target.constraints.find((c) => c.kind === 'pk')
  if (pk && pk.columns.length > 0) {
    const nameById = new Map(target.columns.map((c) => [c.id, c.name]))
    return pk.columns.map((r) => nameById.get(r.columnId) ?? r.columnId)
  }
  return target.columns.length > 0 ? [target.columns[0].name] : []
}

/**
 * 드래그로 생성할 FK 의 제약 패치(updateConstraint 로 흘려 넣을 부분값).
 * - columns: 소스 컬럼 1개(핸들에서 온 컬럼)
 * - refTable: 대상 테이블명
 * - refColumns: 대상 PK(기본)
 * source 컬럼이 소스 테이블에 없으면 null(무효 드롭).
 */
export function buildFkPatch(
  source: TableDef,
  sourceColumnId: string,
  target: TableDef
): Pick<Constraint, 'columns' | 'refTable' | 'refColumns'> | null {
  const col = source.columns.find((c) => c.id === sourceColumnId)
  if (!col) return null
  return {
    columns: [{ columnId: sourceColumnId }],
    refTable: target.name,
    refColumns: defaultRefColumns(target)
  }
}
