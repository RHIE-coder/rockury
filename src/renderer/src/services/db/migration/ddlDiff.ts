import type { DialectId } from '../dialects'
import type { Column, Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from '../versions/store'
import { generateDdl, isMyDialect, mapType, qualifiedTable, quoteId } from '../workspaces/definition/ddl'
import { resolveColumns } from '../workspaces/definition/derive'
import { hasMultipleSchemas, qualifiedName } from '../schemaRef'

/**
 * 반영 계획 생성(§ops-plan Phase 3c) — 두 스냅샷 델타를 **ALTER/CREATE/DROP SQL** 로 접는다.
 * `versions/diff.ts` 가 델타를 "표시"한다면, 이건 델타를 "실행 가능한 DDL"로 만든다(diff③ Plan).
 * 파괴적(DROP/데이터 손실 가능) 문은 flag 로 표시 — 항상 사람 승인 게이트(§IA).
 * 순수 함수 → 테스트 의무 대상. id 기준 매칭(같은 설계 계보/introspection 이름 기반 id).
 */
export interface MigrationStatement {
  sql: string
  kind: 'create' | 'drop' | 'alter' | 'index'
  destructive: boolean
  table: string
  note?: string
}

export interface MigrationPlan {
  statements: MigrationStatement[]
  destructiveCount: number
  /** 이 방언에서 자동 생성 못 한 항목(예: sqlite 컬럼 변경) — 사람이 수동 처리. */
  unsupported: string[]
}

const q = quoteId
const esc = (s: string): string => s.replace(/'/g, "''")

/** ADD/MODIFY COLUMN 용 컬럼 절 — `name` TYPE [NULL|NOT NULL] [DEFAULT x] [COMMENT '...'(mysql)]. */
function columnClause(d: DialectId, c: Column): string {
  const parts = [q(d, c.name), mapType(d, c.type), c.nullable ? 'NULL' : 'NOT NULL']
  if (c.defaultValue != null && c.defaultValue !== '') parts.push(`DEFAULT ${c.defaultValue}`)
  if (isMyDialect(d) && c.comment) parts.push(`COMMENT '${esc(c.comment)}'`)
  return parts.join(' ')
}

function colList(d: DialectId, t: TableDef, con: Constraint, withDir: boolean): string {
  return (
    '(' +
    resolveColumns(t, con)
      .map((c) => `${q(d, c.name)}${withDir && c.direction === 'DESC' ? ' DESC' : ''}`)
      .join(', ') +
    ')'
  )
}

/** "CONSTRAINT name ..." 절(pk/uk/fk/check). idx 는 여기서 다루지 않음(CREATE INDEX). */
function constraintClause(d: DialectId, t: TableDef, k: Constraint): string {
  const name = q(d, k.name)
  switch (k.kind) {
    case 'pk':
      return `CONSTRAINT ${name} PRIMARY KEY ${colList(d, t, k, false)}`
    case 'uk':
      return `CONSTRAINT ${name} ${isMyDialect(d) ? 'UNIQUE KEY' : 'UNIQUE'} ${colList(d, t, k, isMyDialect(d))}`
    case 'fk': {
      const refCols = (k.refColumns ?? []).map((rc) => q(d, rc)).join(', ')
      let line = `CONSTRAINT ${name} FOREIGN KEY ${colList(d, t, k, false)} REFERENCES ${q(d, k.refTable ?? '?')} (${refCols})`
      if (k.onDelete) line += ` ON DELETE ${k.onDelete}`
      if (k.onUpdate) line += ` ON UPDATE ${k.onUpdate}`
      return line
    }
    default:
      return `CONSTRAINT ${name} CHECK (${k.expression ?? ''})`
  }
}

const colKey = (c: Column): string =>
  JSON.stringify([c.name, c.type, c.nullable, c.defaultValue ?? null, c.comment])
const conKey = (k: Constraint): string =>
  JSON.stringify([
    k.kind,
    k.name,
    k.columns.map((r) => [r.columnId, r.direction ?? 'ASC']),
    k.refSchema ?? '',
    k.refTable ?? '',
    k.refColumns ?? [],
    k.onDelete ?? '',
    k.onUpdate ?? '',
    k.expression ?? ''
  ])

/**
 * @param sqlName **이미 인용된** 테이블 이름(스키마 한정 포함) — 여기서 다시 인용하지 않는다.
 * @param label   화면·기록에 쓸 이름(스키마가 섞였으면 한정 이름).
 */
function dropConstraint(
  d: DialectId,
  sqlName: string,
  label: string,
  k: Constraint,
  out: MigrationStatement[],
  unsupported: string[]
): void {
  const name = q(d, k.name)
  if (d === 'sqlite') {
    unsupported.push(`sqlite: ${label}.${k.name} 제약 삭제는 테이블 재생성 필요`)
    return
  }
  if (d === 'postgresql') {
    const sql =
      k.kind === 'idx' ? `DROP INDEX ${name};` : `ALTER TABLE ${sqlName} DROP CONSTRAINT ${name};`
    out.push({ sql, kind: 'alter', destructive: true, table: label })
    return
  }
  // mysql/mariadb
  let sql: string
  if (k.kind === 'pk') sql = `ALTER TABLE ${sqlName} DROP PRIMARY KEY;`
  else if (k.kind === 'fk') sql = `ALTER TABLE ${sqlName} DROP FOREIGN KEY ${name};`
  else if (k.kind === 'check') sql = `ALTER TABLE ${sqlName} DROP CHECK ${name};`
  else sql = `ALTER TABLE ${sqlName} DROP INDEX ${name};`
  out.push({ sql, kind: 'alter', destructive: true, table: label })
}

function addConstraint(
  d: DialectId,
  t: TableDef,
  sqlName: string,
  label: string,
  k: Constraint,
  out: MigrationStatement[]
): void {
  if (k.kind === 'idx') {
    out.push({
      sql: `CREATE INDEX ${q(d, k.name)} ON ${sqlName} ${colList(d, t, k, true)};`,
      kind: 'index',
      destructive: false,
      table: label
    })
    return
  }
  out.push({
    sql: `ALTER TABLE ${sqlName} ADD ${constraintClause(d, t, k)};`,
    kind: 'alter',
    destructive: false,
    table: label
  })
}

/**
 * @param sqlName **이미 인용된** 테이블 이름(스키마 한정 포함). @param label 화면에 쓸 이름.
 */
function modifyColumn(
  d: DialectId,
  sqlName: string,
  label: string,
  before: Column,
  after: Column,
  out: MigrationStatement[],
  unsupported: string[]
): void {
  if (isMyDialect(d)) {
    const verb = before.name !== after.name ? `CHANGE COLUMN ${q(d, before.name)}` : 'MODIFY COLUMN'
    out.push({
      sql: `ALTER TABLE ${sqlName} ${verb} ${columnClause(d, after)};`,
      kind: 'alter',
      destructive: false,
      table: label
    })
    return
  }
  if (d === 'postgresql') {
    if (before.name !== after.name)
      out.push({ sql: `ALTER TABLE ${sqlName} RENAME COLUMN ${q(d, before.name)} TO ${q(d, after.name)};`, kind: 'alter', destructive: false, table: label })
    const col = q(d, after.name)
    if (before.type !== after.type)
      out.push({ sql: `ALTER TABLE ${sqlName} ALTER COLUMN ${col} TYPE ${mapType(d, after.type)};`, kind: 'alter', destructive: false, table: label })
    if (before.nullable !== after.nullable)
      out.push({ sql: `ALTER TABLE ${sqlName} ALTER COLUMN ${col} ${after.nullable ? 'DROP' : 'SET'} NOT NULL;`, kind: 'alter', destructive: false, table: label })
    if ((before.defaultValue ?? null) !== (after.defaultValue ?? null))
      out.push({
        sql:
          after.defaultValue == null || after.defaultValue === ''
            ? `ALTER TABLE ${sqlName} ALTER COLUMN ${col} DROP DEFAULT;`
            : `ALTER TABLE ${sqlName} ALTER COLUMN ${col} SET DEFAULT ${after.defaultValue};`,
        kind: 'alter',
        destructive: false,
        table: label
      })
    return
  }
  // sqlite — RENAME 만 지원, 정의 변경은 테이블 재생성 필요
  if (before.name !== after.name)
    out.push({ sql: `ALTER TABLE ${sqlName} RENAME COLUMN ${q(d, before.name)} TO ${q(d, after.name)};`, kind: 'alter', destructive: false, table: label })
  if (before.type !== after.type || before.nullable !== after.nullable || (before.defaultValue ?? null) !== (after.defaultValue ?? null))
    unsupported.push(`sqlite: ${label}.${after.name} 정의 변경은 테이블 재생성 필요`)
}

export function generateMigration(
  base: VersionSnapshot,
  target: VersionSnapshot,
  d: DialectId
): MigrationPlan {
  const out: MigrationStatement[] = []
  const unsupported: string[] = []
  const baseTables = new Map(base.tables.map((t) => [t.id, t]))
  const targetTables = new Map(target.tables.map((t) => [t.id, t]))

  // 스키마가 둘 이상 걸려 있을 때만 한정 이름을 쓴다 — 하나뿐이면 예전 계획과 글자가 같아야 한다
  // (§db-design.definition.sql AC-1 과 같은 규칙).
  const qualify = hasMultipleSchemas([...base.tables, ...target.tables])
  /** SQL 에 쓸 이름. */
  const sqlName = (t: TableDef): string => qualifiedTable(d, t, qualify)
  /** 화면·기록에 쓸 이름 — 스키마가 섞였으면 어느 스키마 것인지 말해야 한다. */
  const label = (t: TableDef): string => (qualify ? qualifiedName(t) : t.name)

  // 삭제된 테이블 → DROP (파괴적)
  for (const [id, bt] of baseTables) {
    if (!targetTables.has(id))
      out.push({ sql: `DROP TABLE ${sqlName(bt)};`, kind: 'drop', destructive: true, table: label(bt) })
  }

  for (const [id, tt] of targetTables) {
    const bt = baseTables.get(id)
    if (!bt) {
      // 새 테이블 → CREATE (generateDdl 재사용, 다중문 블록)
      out.push({ sql: generateDdl(tt, d, { qualify }), kind: 'create', destructive: false, table: label(tt) })
      continue
    }

    // 테이블 이름 변경
    if (bt.name !== tt.name)
      out.push({ sql: `ALTER TABLE ${sqlName(bt)} RENAME TO ${q(d, tt.name)};`, kind: 'alter', destructive: false, table: label(tt) })
    // 스키마 이동은 이름 변경과 다른 문이다 — 안 내면 테이블이 옛 스키마에 그대로 남는다.
    if (qualify && (bt.schema ?? '') !== (tt.schema ?? '') && tt.schema && d === 'postgresql')
      out.push({
        sql: `ALTER TABLE ${q(d, bt.schema ?? '')}.${q(d, tt.name)} SET SCHEMA ${q(d, tt.schema)};`,
        kind: 'alter',
        destructive: false,
        table: label(tt)
      })

    const baseCols = new Map(bt.columns.map((c) => [c.id, c]))
    const targetCols = new Map(tt.columns.map((c) => [c.id, c]))
    const baseCons = new Map(bt.constraints.map((k) => [k.id, k]))
    const targetCons = new Map(tt.constraints.map((k) => [k.id, k]))

    // 1) 컬럼 추가
    for (const [cid, tc] of targetCols)
      if (!baseCols.has(cid))
        out.push({ sql: `ALTER TABLE ${sqlName(tt)} ADD COLUMN ${columnClause(d, tc)};`, kind: 'alter', destructive: false, table: label(tt) })
    // 2) 컬럼 변경
    for (const [cid, tc] of targetCols) {
      const bc = baseCols.get(cid)
      if (bc && colKey(bc) !== colKey(tc)) modifyColumn(d, sqlName(tt), label(tt), bc, tc, out, unsupported)
    }
    // 3) 삭제/변경된 제약 DROP (컬럼 삭제 전에)
    for (const [kid, bk] of baseCons) {
      const tk = targetCons.get(kid)
      if (!tk || conKey(bk) !== conKey(tk)) dropConstraint(d, sqlName(tt), label(tt), bk, out, unsupported)
    }
    // 4) 삭제된 컬럼 DROP (파괴적)
    for (const [cid, bc] of baseCols)
      if (!targetCols.has(cid))
        out.push({ sql: `ALTER TABLE ${sqlName(tt)} DROP COLUMN ${q(d, bc.name)};`, kind: 'alter', destructive: true, table: label(tt) })
    // 5) 추가/변경된 제약 ADD (컬럼 준비 후)
    for (const [kid, tk] of targetCons) {
      const bk = baseCons.get(kid)
      if (!bk || conKey(bk) !== conKey(tk)) addConstraint(d, tt, sqlName(tt), label(tt), tk, out)
    }
    // 6) 테이블 코멘트 변경
    if ((bt.comment ?? '') !== (tt.comment ?? '')) {
      if (isMyDialect(d))
        out.push({ sql: `ALTER TABLE ${sqlName(tt)} COMMENT = '${esc(tt.comment)}';`, kind: 'alter', destructive: false, table: label(tt) })
      else if (d === 'postgresql')
        out.push({ sql: `COMMENT ON TABLE ${q(d, tt.name)} IS '${esc(tt.comment)}';`, kind: 'alter', destructive: false, table: label(tt) })
    }
  }

  return { statements: out, destructiveCount: out.filter((s) => s.destructive).length, unsupported }
}
