import type {
  Column,
  Constraint,
  ConstraintKind,
  ResolvedConstraintColumn,
  TableDef
} from '../workspaces/definition/types'
import type { SchemaDiff } from '../versions/diff'
import type { VersionSnapshot } from '../versions/store'

/**
 * 대조표 만들기 — **"원래 어떤 테이블이었고 어떻게 변하나"** 를 한 눈에 보이게 하는 순수 변환.
 *
 * 왜 필요한가: `SchemaDiff` 는 **바뀐 것만** 담는다. 그래서 그것만 그리면 "34개 문이 나간다"는
 * 알겠는데 *원래 테이블이 어떻게 생겼고 결과가 어떤 모양이 되는지*는 알 수 없다. SQL 목록을
 * 읽어 머릿속에서 테이블을 재구성해야 하는데, 그건 외우기도 힘들고 판단 근거로도 약하다
 * (2026-08-10 사용자 지적).
 *
 * 그래서 여기서는 **양쪽 스냅샷을 합쳐 전부 늘어놓고**, 각 줄에 상태만 달아 준다.
 * 안 바뀐 줄도 남기는 것이 요점이다 — 맥락이 있어야 바뀐 줄이 읽힌다.
 */

export type RowStatus = 'added' | 'removed' | 'modified' | 'same'

export interface FieldRow {
  /** 사람이 읽는 이름. 이름이 바뀐 경우 **바뀐 뒤 이름**을 쓰되 before 에 옛 모습이 남는다. */
  name: string
  status: RowStatus
  /** 변경 전 모습. 새로 생긴 줄이면 null. */
  before: string | null
  /** 변경 후 모습. 사라진 줄이면 null. */
  after: string | null
  /**
   * 화면에 그릴 원본 컬럼 — Definition 과 **같은 표**(타입·키·NULL·기본값·설명)를 그리려면
   * 문자열 요약만으로는 모자란다. 사라지는 줄은 before 쪽 것을 든다.
   */
  col?: Column
  /** 사라지는 줄이 아닐 때, 바뀌기 전 컬럼. 옛 값을 나란히 보이는 데 쓴다. */
  prevCol?: Column
}

export interface ConstraintRow extends FieldRow {
  kind: ConstraintKind
  con?: Constraint
  prevCon?: Constraint
  /**
   * `con.columns` 를 이름으로 푼 것 — **화면이 직접 못 푼다.** 사라지는 제약은 before 쪽 컬럼을
   * 가리키는데 표가 들고 있는 테이블은 after 쪽이라, 거기서 찾으면 전부 `?` 가 된다.
   */
  cols: ResolvedConstraintColumn[]
}

export interface TableView {
  id: string
  name: string
  schema?: string
  status: RowStatus
  columns: FieldRow[]
  constraints: ConstraintRow[]
  /** 이 테이블 안에 바뀐 줄이 하나라도 있나 — 목록 배지와 "바뀐 것만" 거르기에 쓴다. */
  changed: boolean
  /**
   * 원본 테이블(사라지는 것은 before, 그 밖에는 after).
   * 좌측 목록이 컬럼 수를 세고 컬럼 이름으로 검색하는 데 쓴다 — 빈 껍데기를 넘기면
   * 목록이 "컬럼 0개"라고 거짓말을 한다.
   */
  def: TableDef
}

export interface DiffView {
  tables: TableView[]
  /** 바뀐 테이블 수 — 머리말에 쓴다. */
  changedCount: number
}

const nullLabel = (nullable: boolean): string => (nullable ? 'NULL' : 'NOT NULL')

/** 컬럼 한 줄의 모습 — `bigint NOT NULL DEFAULT 0` 꼴. diff 화면과 같은 낱말을 쓴다. */
export function columnShape(c: Column): string {
  const parts = [c.type, nullLabel(c.nullable)]
  if (c.defaultValue != null && c.defaultValue !== '') parts.push(`DEFAULT ${c.defaultValue}`)
  return parts.join(' ')
}

/** 제약이 거는 컬럼을 이름으로 푼다 — 순서가 곧 복합 키 순번이라 배열 순서를 지킨다. */
export function resolveConstraintColumns(k: Constraint, cols: Column[]): ResolvedConstraintColumn[] {
  return k.columns.map((r) => ({
    name: cols.find((c) => c.id === r.columnId)?.name ?? '?',
    direction: r.direction
  }))
}

/**
 * 제약 한 줄의 모습 — 종류마다 무엇이 중요한지가 달라 갈라 적는다.
 *
 * **FK 는 정책까지 적는다.** 안 적으면 ON DELETE 만 바뀐 FK 가 앞뒤 문자열이 같아져 `same` 으로
 * 판정된다 — SQL 은 나가는데 대조표는 조용한 어긋남이었다(2026-08-11 사용자 지적).
 * 값이 없는 쪽은 빼는데, SQL 차이 판정(`versions/diff`)이 "안 씀 ≠ NO ACTION" 으로 세는 것과
 * 같은 셈법을 쓰기 위해서다.
 */
export function constraintShape(k: Constraint, cols: Column[]): string {
  const names = resolveConstraintColumns(k, cols)
    .map((c) => (c.direction === 'DESC' ? `${c.name} DESC` : c.name))
    .join(', ')
  if (k.kind === 'fk') {
    const ref = [k.refSchema, k.refTable].filter(Boolean).join('.')
    const policies = [
      k.onDelete && `ON DELETE ${k.onDelete}`,
      k.onUpdate && `ON UPDATE ${k.onUpdate}`
    ].filter(Boolean)
    return [`(${names}) → ${ref}(${(k.refColumns ?? []).join(', ')})`, ...policies].join(' ')
  }
  if (k.kind === 'check') return k.expression ?? ''
  return `(${names})`
}

/** 컬럼 짝짓기 — 이름으로 맞춘다(양쪽 id 스킴이 다를 수 있다). */
function pairColumns(before: Column[], after: Column[]): FieldRow[] {
  const beforeByName = new Map(before.map((c) => [c.name, c]))
  const afterByName = new Map(after.map((c) => [c.name, c]))
  const out: FieldRow[] = []

  // 순서는 **결과(after) 기준**이다 — 반영 뒤 테이블이 어떤 모양이 될지가 읽는 사람의 관심사다.
  for (const a of after) {
    const b = beforeByName.get(a.name)
    if (!b) {
      out.push({ name: a.name, status: 'added', before: null, after: columnShape(a), col: a })
      continue
    }
    const bs = columnShape(b)
    const as = columnShape(a)
    out.push({
      name: a.name,
      status: bs === as ? 'same' : 'modified',
      before: bs,
      after: as,
      col: a,
      prevCol: b
    })
  }
  // 사라진 것은 뒤에 모아 붙인다 — 결과에 없는 줄이라 자리를 잡아 줄 데가 없다.
  for (const b of before) {
    if (!afterByName.has(b.name))
      out.push({ name: b.name, status: 'removed', before: columnShape(b), after: null, col: b })
  }
  return out
}

function pairConstraints(
  before: Constraint[],
  beforeCols: Column[],
  after: Constraint[],
  afterCols: Column[]
): ConstraintRow[] {
  // 이름에 절대 못 들어가는 글자라 구분자로 쓴다 — 글자 그대로 넣으면 git 이 파일을 바이너리로 본다(diff 가 사라진다).
  const key = (k: Constraint): string => `${k.kind}\u0000${k.name}`
  const beforeByKey = new Map(before.map((k) => [key(k), k]))
  const afterByKey = new Map(after.map((k) => [key(k), k]))
  const out: ConstraintRow[] = []

  for (const a of after) {
    const b = beforeByKey.get(key(a))
    const as = constraintShape(a, afterCols)
    if (!b) {
      out.push({
        name: a.name,
        kind: a.kind,
        status: 'added',
        before: null,
        after: as,
        con: a,
        cols: resolveConstraintColumns(a, afterCols)
      })
      continue
    }
    const bs = constraintShape(b, beforeCols)
    out.push({
      name: a.name,
      kind: a.kind,
      status: bs === as ? 'same' : 'modified',
      before: bs,
      after: as,
      con: a,
      prevCon: b,
      cols: resolveConstraintColumns(a, afterCols)
    })
  }
  for (const b of before) {
    if (!afterByKey.has(key(b)))
      out.push({
        name: b.name,
        kind: b.kind,
        status: 'removed',
        before: constraintShape(b, beforeCols),
        after: null,
        con: b,
        cols: resolveConstraintColumns(b, beforeCols)
      })
  }
  return out
}

/** 스키마까지 붙인 이름 — 같은 이름이 여러 스키마에 있을 수 있어 이것이 정체성이다. */
const qualified = (t: { schema?: string; name: string }): string =>
  t.schema ? `${t.schema}.${t.name}` : t.name

/**
 * 두 스냅샷을 합쳐 전체 대조표를 만든다.
 *
 * `diff` 는 받지 않는다 — 양쪽 스냅샷만 있으면 상태를 스스로 낼 수 있고, 그래야 diff 계산과
 * 화면 표기가 어긋날 일이 없다(두 곳에서 따로 판정하면 언젠가 한쪽만 고쳐진다).
 */
export function buildDiffView(before: VersionSnapshot, after: VersionSnapshot): DiffView {
  const beforeByName = new Map(before.tables.map((t) => [qualified(t), t]))
  const afterByName = new Map(after.tables.map((t) => [qualified(t), t]))

  const tables: TableView[] = []

  for (const a of after.tables) {
    const b = beforeByName.get(qualified(a))
    if (!b) {
      tables.push({
        id: a.id,
        name: a.name,
        schema: a.schema,
        status: 'added',
        columns: a.columns.map((c) => ({ name: c.name, status: 'added' as const, before: null, after: columnShape(c), col: c })),
        constraints: a.constraints.map((k) => ({
          name: k.name, kind: k.kind, status: 'added' as const, before: null, after: constraintShape(k, a.columns),
          con: k, cols: resolveConstraintColumns(k, a.columns)
        })),
        changed: true,
        def: a
      })
      continue
    }
    const columns = pairColumns(b.columns, a.columns)
    const constraints = pairConstraints(b.constraints, b.columns, a.constraints, a.columns)
    const changed =
      columns.some((c) => c.status !== 'same') ||
      constraints.some((k) => k.status !== 'same') ||
      b.comment !== a.comment
    tables.push({
      id: a.id,
      name: a.name,
      schema: a.schema,
      status: changed ? 'modified' : 'same',
      columns,
      constraints,
      changed,
      def: a
    })
  }

  for (const b of before.tables) {
    if (afterByName.has(qualified(b))) continue
    tables.push({
      id: b.id,
      name: b.name,
      schema: b.schema,
      status: 'removed',
      columns: b.columns.map((c) => ({ name: c.name, status: 'removed' as const, before: columnShape(c), after: null, col: c })),
      constraints: b.constraints.map((k) => ({
        name: k.name, kind: k.kind, status: 'removed' as const, before: constraintShape(k, b.columns), after: null,
        con: k, cols: resolveConstraintColumns(k, b.columns)
      })),
      changed: true,
      def: b
    })
  }

  // 바뀐 것을 위로 — 목록이 길 때 스크롤하지 않고도 할 일이 보여야 한다.
  const order: Record<RowStatus, number> = { added: 0, modified: 1, removed: 2, same: 3 }
  tables.sort((x, y) => order[x.status] - order[y.status] || qualified(x).localeCompare(qualified(y)))

  return { tables, changedCount: tables.filter((t) => t.changed).length }
}

/** 대조표에 든 스키마 한 칸 — 토글이 이 단위로 켜고 꺼진다. */
export interface SchemaSlice {
  /** 스키마 이름. 스키마 개념이 없는 DB 는 빈 문자열 한 칸으로 모인다. */
  name: string
  /** 이 스키마의 테이블 수. */
  total: number
  /** 그중 바뀌는 것. */
  changed: number
}

/**
 * 대조표에 실제로 **든** 스키마만 센다 — 연결이 읽은 범위가 아니라.
 * 테이블이 하나도 안 걸린 스키마에 토글을 주면 켜도 꺼도 화면이 안 변한다.
 */
export function schemasOf(view: DiffView): SchemaSlice[] {
  const by = new Map<string, SchemaSlice>()
  for (const t of view.tables) {
    const name = t.schema ?? ''
    const s = by.get(name) ?? { name, total: 0, changed: 0 }
    s.total += 1
    if (t.changed) s.changed += 1
    by.set(name, s)
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 스키마로 거른 대조표 — **보기만 거른다.** 실행에 나갈 SQL 은 이것과 무관하게 계획 전체다
 * (여기서 거른 것이 실행에서도 빠지면, 화면에서 숨긴 테이블이 조용히 안 나가는 사고가 된다).
 */
export function filterView(view: DiffView, enabled: ReadonlySet<string>): DiffView {
  const tables = view.tables.filter((t) => enabled.has(t.schema ?? ''))
  return { tables, changedCount: tables.filter((t) => t.changed).length }
}

/**
 * 목록에 세울 TableDef 꼴 — 공용 `TableSidePanel` 이 이 모양을 받는다.
 * id 는 대조표의 것으로 바꿔 단다(양쪽 스냅샷의 id 스킴이 달라도 목록↔본문이 같은 열쇠를 쓰게).
 */
export function asTableDefs(view: DiffView, designId: string): TableDef[] {
  return view.tables.map((t) => ({ ...t.def, id: t.id, designId }))
}

/** 이 diff 를 만든 두 스냅샷이 같은가 — 화면이 "변경 없음"을 가릴 때 쓴다. */
export function isEmptyView(view: DiffView): boolean {
  return view.changedCount === 0
}

/** SchemaDiff 요약을 그대로 받아 쓰기 위한 얇은 통로(요약 칩은 기존 문법을 재사용한다). */
export type { SchemaDiff }
