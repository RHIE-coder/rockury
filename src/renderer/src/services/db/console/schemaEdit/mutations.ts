import type { DialectId } from '../../dialects'
import { autoIncrementToken } from '../../typeCatalog'
import type { Column, Constraint, ConstraintKind, TableDef } from '../../workspaces/definition/types'

/**
 * Console 라이브 스키마 편집의 **순수 reducer**(입력→출력 결정적 → 테스트 의무).
 * draft(편집본) `TableDef[]` 를 변형만 한다 — 저장·DDL 실행은 store 가 한다.
 *
 * Studio 편집(설계 draft)과 도메인 규칙은 같지만, 여기선:
 *  - baseline(introspection) 과의 diff 로 ALTER DDL 을 만든다(`generateMigration`) → 기존 id 는 보존해야
 *    "변경"으로, 새 엔티티는 introspection id(`t:`/`c:`/`k:`)와 겹치지 않는 `new:` 접두 id 로 만들어 "추가"로 잡힌다.
 *  - 새 id 는 store 가 시퀀스로 만들어 인자로 넘긴다(reducer 는 순수 유지).
 */

const patchActive = (tables: TableDef[], activeId: string, map: (t: TableDef) => TableDef): TableDef[] =>
  tables.map((t) => (t.id === activeId ? map(t) : t))

/** 키 성격 제약(pk/uk/idx/fk)에서 컬럼이 비면 제거. check 는 컬럼 무관이라 유지. */
const pruneEmpty = (cons: Constraint[]): Constraint[] =>
  cons.filter((k) => k.kind === 'check' || k.columns.length > 0)

// ── Column ──
export function addColumn(tables: TableDef[], activeId: string, newColId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    columns: [
      ...t.columns,
      { id: newColId, name: '', type: 'VARCHAR(255)', nullable: true, defaultValue: null, comment: '' }
    ]
  }))
}

export function updateColumn(
  tables: TableDef[],
  activeId: string,
  colId: string,
  patch: Partial<Column>
): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    columns: t.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c))
  }))
}

export function toggleNullable(tables: TableDef[], activeId: string, colId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    columns: t.columns.map((c) => (c.id === colId ? { ...c, nullable: !c.nullable } : c))
  }))
}

export function moveColumn(tables: TableDef[], activeId: string, colId: string, dir: -1 | 1): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    const i = t.columns.findIndex((c) => c.id === colId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= t.columns.length) return t
    const columns = [...t.columns]
    ;[columns[i], columns[j]] = [columns[j], columns[i]]
    return { ...t, columns }
  })
}

export function reorderColumns(
  tables: TableDef[],
  activeId: string,
  activeColId: string,
  overColId: string
): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    const from = t.columns.findIndex((c) => c.id === activeColId)
    const to = t.columns.findIndex((c) => c.id === overColId)
    if (from < 0 || to < 0 || from === to) return t
    const columns = [...t.columns]
    const [moved] = columns.splice(from, 1)
    columns.splice(to, 0, moved)
    return { ...t, columns }
  })
}

export function deleteColumn(tables: TableDef[], activeId: string, colId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    columns: t.columns.filter((c) => c.id !== colId),
    constraints: pruneEmpty(
      t.constraints.map((k) => ({ ...k, columns: k.columns.filter((r) => r.columnId !== colId) }))
    )
  }))
}

// ── 퀵 키 토글(제약 기반) ──
export function togglePk(tables: TableDef[], activeId: string, colId: string, newConId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    const pk = t.constraints.find((k) => k.kind === 'pk')
    if (!pk) {
      return {
        ...t,
        constraints: [
          ...t.constraints,
          { id: newConId, kind: 'pk', name: `pk_${t.name}`, columns: [{ columnId: colId }] }
        ]
      }
    }
    const has = pk.columns.some((r) => r.columnId === colId)
    const columns = has
      ? pk.columns.filter((r) => r.columnId !== colId)
      : [...pk.columns, { columnId: colId }]
    return { ...t, constraints: pruneEmpty(t.constraints.map((k) => (k.id === pk.id ? { ...k, columns } : k))) }
  })
}

export function toggleUnique(tables: TableDef[], activeId: string, colId: string, newConId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    const existing = t.constraints.find(
      (k) => k.kind === 'uk' && k.columns.length === 1 && k.columns[0].columnId === colId
    )
    if (existing) return { ...t, constraints: t.constraints.filter((k) => k.id !== existing.id) }
    const colName = t.columns.find((c) => c.id === colId)?.name ?? 'col'
    return {
      ...t,
      constraints: [
        ...t.constraints,
        { id: newConId, kind: 'uk', name: `uq_${t.name}_${colName}`, columns: [{ columnId: colId }] }
      ]
    }
  })
}

export function toggleIndex(tables: TableDef[], activeId: string, colId: string, newConId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    const existing = t.constraints.find(
      (k) => k.kind === 'idx' && k.columns.length === 1 && k.columns[0].columnId === colId
    )
    if (existing) return { ...t, constraints: t.constraints.filter((k) => k.id !== existing.id) }
    const colName = t.columns.find((c) => c.id === colId)?.name ?? 'col'
    return {
      ...t,
      constraints: [
        ...t.constraints,
        { id: newConId, kind: 'idx', name: `idx_${t.name}_${colName}`, columns: [{ columnId: colId }] }
      ]
    }
  })
}

// ── Constraint ──
export function addConstraint(
  tables: TableDef[],
  activeId: string,
  kind: ConstraintKind,
  newConId: string
): TableDef[] {
  return patchActive(tables, activeId, (t) => {
    // PK 는 테이블당 하나 — 이미 있으면 그대로.
    if (kind === 'pk' && t.constraints.some((k) => k.kind === 'pk')) return t
    const n = t.constraints.filter((k) => k.kind === kind).length + 1
    const base: Constraint = { id: newConId, kind, name: '', columns: [] }
    switch (kind) {
      case 'pk':
        base.name = `pk_${t.name}`
        break
      case 'uk':
        base.name = `uq_${t.name}_${n}`
        break
      case 'idx':
        base.name = `idx_${t.name}_${n}`
        break
      case 'check':
        base.name = `chk_${t.name}_${n}`
        base.expression = ''
        break
      case 'fk':
        base.name = `fk_${t.name}_${n}`
        base.refTable = ''
        base.refColumns = []
        base.onDelete = 'RESTRICT'
        base.onUpdate = 'RESTRICT'
        break
    }
    return { ...t, constraints: [...t.constraints, base] }
  })
}

export function updateConstraint(
  tables: TableDef[],
  activeId: string,
  conId: string,
  patch: Partial<Constraint>
): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    constraints: t.constraints.map((k) => (k.id === conId ? { ...k, ...patch } : k))
  }))
}

export function deleteConstraint(tables: TableDef[], activeId: string, conId: string): TableDef[] {
  return patchActive(tables, activeId, (t) => ({
    ...t,
    constraints: t.constraints.filter((k) => k.id !== conId)
  }))
}

// ── Table ──
export interface NewTableIds {
  tableId: string
  colId: string
  conId: string
}

/** 새 테이블 추가 — 방언 네이티브 PK 컬럼 템플릿. 새 활성 테이블 id 를 함께 돌려준다. */
export function addTable(
  tables: TableDef[],
  dialect: DialectId,
  ids: NewTableIds
): { tables: TableDef[]; activeTableId: string } {
  const idType =
    dialect === 'postgresql' ? 'BIGINT' : dialect === 'sqlite' ? 'INTEGER' : 'BIGINT UNSIGNED'
  const name = `new_table_${tables.length + 1}`
  const table: TableDef = {
    id: ids.tableId,
    designId: '',
    name,
    comment: '',
    columns: [
      { id: ids.colId, name: 'id', type: idType, nullable: false, defaultValue: autoIncrementToken(dialect), comment: '' }
    ],
    constraints: [{ id: ids.conId, kind: 'pk', name: `pk_${name}`, columns: [{ columnId: ids.colId }] }]
  }
  return { tables: [...tables, table], activeTableId: ids.tableId }
}

export function updateTable(
  tables: TableDef[],
  activeId: string,
  patch: Partial<Pick<TableDef, 'name' | 'comment'>>
): TableDef[] {
  return patchActive(tables, activeId, (t) => ({ ...t, ...patch }))
}

/** 테이블 삭제 — 남은 첫 테이블로 활성 폴백(없으면 ''). */
export function deleteTable(
  tables: TableDef[],
  id: string
): { tables: TableDef[]; activeTableId: string } {
  const next = tables.filter((t) => t.id !== id)
  return { tables: next, activeTableId: next[0]?.id ?? '' }
}
