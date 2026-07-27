import type { Column, Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from './store'

/**
 * 스냅샷 diff (IA diff ①) — 두 버전의 스키마 델타를 순수 계산한다(DB 불필요).
 * 매칭은 id 기준(같은 설계 계보라 테이블·컬럼·제약 id 가 버전 간 안정적).
 */
export type ChangeStatus = 'added' | 'removed' | 'modified'

export interface FieldChange {
  field: string
  before: string
  after: string
}

export interface ColumnDiff {
  id: string
  name: string
  status: ChangeStatus
  changes: FieldChange[]
}

export interface ConstraintDiff {
  id: string
  name: string
  kind: string
  status: ChangeStatus
  changes: FieldChange[]
}

export interface TableDiff {
  id: string
  name: string
  status: ChangeStatus
  /** 테이블 자체 속성(이름·코멘트) 변경. */
  tableChanges: FieldChange[]
  /** 변경된 컬럼만(added/removed/modified). */
  columns: ColumnDiff[]
  /** 변경된 제약만. */
  constraints: ConstraintDiff[]
}

export interface DiffSummary {
  tablesAdded: number
  tablesRemoved: number
  tablesModified: number
  columnsAdded: number
  columnsRemoved: number
  columnsModified: number
  constraintsAdded: number
  constraintsRemoved: number
  constraintsModified: number
}

export interface SchemaDiff {
  tables: TableDiff[]
  summary: DiffSummary
}

const nullLabel = (nullable: boolean): string => (nullable ? 'NULL' : 'NOT NULL')
const defLabel = (v: string | null): string => (v == null || v === '' ? '—' : v)

/** 제약의 컬럼 참조를 컬럼명으로 해석(순서 유지, 방향 표기). */
function conColNames(con: Constraint, cols: Column[]): string {
  return con.columns
    .map((r) => {
      const name = cols.find((c) => c.id === r.columnId)?.name ?? '?'
      return r.direction === 'DESC' ? `${name} DESC` : name
    })
    .join(', ')
}

function columnFieldChanges(a: Column, b: Column): FieldChange[] {
  const out: FieldChange[] = []
  if (a.name !== b.name) out.push({ field: '이름', before: a.name, after: b.name })
  if (a.type !== b.type) out.push({ field: '타입', before: a.type, after: b.type })
  if (a.nullable !== b.nullable)
    out.push({ field: 'NULL', before: nullLabel(a.nullable), after: nullLabel(b.nullable) })
  if ((a.defaultValue ?? null) !== (b.defaultValue ?? null))
    out.push({ field: 'DEFAULT', before: defLabel(a.defaultValue), after: defLabel(b.defaultValue) })
  if (a.comment !== b.comment)
    out.push({ field: '설명', before: a.comment || '—', after: b.comment || '—' })
  return out
}

function constraintFieldChanges(
  a: Constraint,
  aCols: Column[],
  b: Constraint,
  bCols: Column[]
): FieldChange[] {
  const out: FieldChange[] = []
  if (a.name !== b.name) out.push({ field: '이름', before: a.name, after: b.name })
  if (a.kind !== b.kind) out.push({ field: '종류', before: a.kind.toUpperCase(), after: b.kind.toUpperCase() })
  const ac = conColNames(a, aCols)
  const bc = conColNames(b, bCols)
  if (ac !== bc) out.push({ field: '컬럼', before: ac || '—', after: bc || '—' })
  if ((a.refTable ?? '') !== (b.refTable ?? ''))
    out.push({ field: '참조 테이블', before: a.refTable || '—', after: b.refTable || '—' })
  if ((a.refColumns ?? []).join(',') !== (b.refColumns ?? []).join(','))
    out.push({ field: '참조 컬럼', before: (a.refColumns ?? []).join(', ') || '—', after: (b.refColumns ?? []).join(', ') || '—' })
  if ((a.onDelete ?? '') !== (b.onDelete ?? ''))
    out.push({ field: 'ON DELETE', before: a.onDelete || '—', after: b.onDelete || '—' })
  if ((a.onUpdate ?? '') !== (b.onUpdate ?? ''))
    out.push({ field: 'ON UPDATE', before: a.onUpdate || '—', after: b.onUpdate || '—' })
  if ((a.expression ?? '') !== (b.expression ?? ''))
    out.push({ field: '조건식', before: a.expression || '—', after: b.expression || '—' })
  return out
}

function diffTable(base: TableDef, target: TableDef): TableDiff | null {
  const tableChanges: FieldChange[] = []
  if (base.name !== target.name)
    tableChanges.push({ field: '이름', before: base.name, after: target.name })
  if (base.comment !== target.comment)
    tableChanges.push({ field: '설명', before: base.comment || '—', after: target.comment || '—' })
  // 테이블 ↔ 뷰 전환과 뷰 본문 변경은 실 DB 반영이 CREATE TABLE/VIEW 로 갈리는 큰 변화다 —
  // 컬럼·제약만 보면 조용히 지나간다.
  if (!!base.isView !== !!target.isView)
    tableChanges.push({
      field: '종류',
      before: base.isView ? '뷰' : '테이블',
      after: target.isView ? '뷰' : '테이블'
    })
  if ((base.viewSql ?? '') !== (target.viewSql ?? ''))
    tableChanges.push({
      field: '뷰 본문',
      before: base.viewSql || '—',
      after: target.viewSql || '—'
    })

  const columns: ColumnDiff[] = []
  const baseCols = new Map(base.columns.map((c) => [c.id, c]))
  const targetCols = new Map(target.columns.map((c) => [c.id, c]))
  for (const [id, b] of baseCols) {
    const t = targetCols.get(id)
    if (!t) columns.push({ id, name: b.name, status: 'removed', changes: [] })
    else {
      const changes = columnFieldChanges(b, t)
      if (changes.length) columns.push({ id, name: t.name, status: 'modified', changes })
    }
  }
  for (const [id, t] of targetCols) {
    if (!baseCols.has(id)) columns.push({ id, name: t.name, status: 'added', changes: [] })
  }

  const constraints: ConstraintDiff[] = []
  const baseCons = new Map(base.constraints.map((k) => [k.id, k]))
  const targetCons = new Map(target.constraints.map((k) => [k.id, k]))
  for (const [id, b] of baseCons) {
    const t = targetCons.get(id)
    if (!t) constraints.push({ id, name: b.name, kind: b.kind, status: 'removed', changes: [] })
    else {
      const changes = constraintFieldChanges(b, base.columns, t, target.columns)
      if (changes.length)
        constraints.push({ id, name: t.name, kind: t.kind, status: 'modified', changes })
    }
  }
  for (const [id, t] of targetCons) {
    if (!baseCons.has(id))
      constraints.push({ id, name: t.name, kind: t.kind, status: 'added', changes: [] })
  }

  if (!tableChanges.length && !columns.length && !constraints.length) return null
  return { id: target.id, name: target.name, status: 'modified', tableChanges, columns, constraints }
}

export function diffSnapshots(base: VersionSnapshot, target: VersionSnapshot): SchemaDiff {
  const summary: DiffSummary = {
    tablesAdded: 0,
    tablesRemoved: 0,
    tablesModified: 0,
    columnsAdded: 0,
    columnsRemoved: 0,
    columnsModified: 0,
    constraintsAdded: 0,
    constraintsRemoved: 0,
    constraintsModified: 0
  }
  const tables: TableDiff[] = []
  const baseTables = new Map(base.tables.map((t) => [t.id, t]))
  const targetTables = new Map(target.tables.map((t) => [t.id, t]))

  for (const [id, b] of baseTables) {
    if (!targetTables.has(id)) {
      tables.push({ id, name: b.name, status: 'removed', tableChanges: [], columns: [], constraints: [] })
      summary.tablesRemoved++
    }
  }
  for (const [id, t] of targetTables) {
    const b = baseTables.get(id)
    if (!b) {
      tables.push({ id, name: t.name, status: 'added', tableChanges: [], columns: [], constraints: [] })
      summary.tablesAdded++
    } else {
      const d = diffTable(b, t)
      if (d) {
        tables.push(d)
        summary.tablesModified++
        for (const c of d.columns) {
          if (c.status === 'added') summary.columnsAdded++
          else if (c.status === 'removed') summary.columnsRemoved++
          else summary.columnsModified++
        }
        for (const k of d.constraints) {
          if (k.status === 'added') summary.constraintsAdded++
          else if (k.status === 'removed') summary.constraintsRemoved++
          else summary.constraintsModified++
        }
      }
    }
  }

  // 표시 순서: 추가 → 변경 → 삭제
  const order: Record<ChangeStatus, number> = { added: 0, modified: 1, removed: 2 }
  tables.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
  return { tables, summary }
}

export function isEmptyDiff(d: SchemaDiff): boolean {
  return d.tables.length === 0
}
