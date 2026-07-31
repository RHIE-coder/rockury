import type { DialectId } from '../../dialects'
import type { Constraint, TableDef } from './types'
import { DEFAULT_SCHEMA, groupBySchema, hasMultipleSchemas, resolveRef } from '../../schemaRef'
import { generateDdl, qualifiedTable, quoteId } from './ddl'
import { resolveColumns } from './derive'

/**
 * 스키마 전체를 **한 번에 실행 가능한** DDL 스크립트로 만든다(`schema.sql`).
 * 테이블 하나짜리 `generateDdl` 과 다른 점은 오직 **순서**다 — 참조당하는 테이블이 먼저 와야
 * FK 가 걸린다. 그래서 이 파일이 하는 일은 정렬과, 정렬로 못 푸는 고리(서로 참조)의 처리다.
 */

/** 실행 순서로 정렬한 결과. */
export interface CreateOrder {
  /** 실행 순서대로의 테이블 — 고리를 끊느라 FK 를 뺀 것은 사본이다(원본은 안 건드린다). */
  tables: TableDef[]
  /** CREATE 에서 빼고 스크립트 끝에서 ALTER 로 거는 FK. */
  deferred: { table: TableDef; constraint: Constraint }[]
}

/**
 * SQLite 는 없는 테이블을 가리키는 FK 로도 CREATE 가 되고(정방향 참조 허용),
 * 반대로 `ALTER TABLE … ADD CONSTRAINT` 자체가 없다 — 미루기가 불가능하고 필요도 없다.
 */
const canDeferFk = (d: DialectId): boolean => d !== 'sqlite'

/**
 * FK 의존 순서로 테이블을 정렬한다(위상 정렬). 같은 조건이면 들어온 순서를 지켜
 * 같은 입력이면 같은 스크립트가 나온다 — 스크립트를 파일로 저장해 비교(diff)하는 쓰임이라
 * 순서가 실행마다 흔들리면 안 된다.
 *
 * 목록 밖 테이블을 가리키는 FK(다른 스키마 등)와 자기 참조는 순서에 영향을 주지 않는다 —
 * 정렬로 풀 수 있는 문제가 아니다.
 */
export function orderForCreate(tables: TableDef[], dialect: DialectId): CreateOrder {
  const relations = tables.filter((t) => !t.isView)
  const views = tables.filter((t) => t.isView)

  /** 테이블 id → 먼저 만들어져야 하는 테이블 id 들. */
  const deps = new Map<string, Set<string>>()
  for (const t of relations) {
    const set = new Set<string>()
    for (const k of t.constraints) {
      if (k.kind !== 'fk') continue
      // 이름만으로 찾으면 다른 스키마의 동명 테이블을 의존으로 잡아 순서가 엉킨다.
      const ref = resolveRef(relations, t, k)
      if (!ref || ref.id === t.id) continue
      set.add(ref.id)
    }
    deps.set(t.id, set)
  }

  const emitted = new Set<string>()
  const ordered: TableDef[] = []
  const deferred: CreateOrder['deferred'] = []
  const pending = [...relations]

  while (pending.length > 0) {
    const i = pending.findIndex((t) => [...(deps.get(t.id) ?? [])].every((d) => emitted.has(d)))
    if (i >= 0) {
      const [t] = pending.splice(i, 1)
      emitted.add(t.id)
      ordered.push(t)
      continue
    }
    // 고리(서로 참조) — 아무도 "먼저"가 될 수 없다. 남은 것 중 첫 번째를 먼저 만들되,
    // 아직 없는 테이블을 가리키는 FK 만 떼어 스크립트 끝으로 미룬다.
    const t = pending.shift()!
    emitted.add(t.id)
    const hold = new Set<string>()
    if (canDeferFk(dialect)) {
      for (const k of t.constraints) {
        if (k.kind !== 'fk') continue
        const ref = resolveRef(relations, t, k)
        if (!ref || ref.id === t.id || emitted.has(ref.id)) continue
        hold.add(k.id)
        deferred.push({ table: t, constraint: k })
      }
    }
    ordered.push(hold.size > 0 ? { ...t, constraints: t.constraints.filter((k) => !hold.has(k.id)) } : t)
  }

  // 뷰는 테이블 뒤 — 본문이 테이블·다른 뷰를 읽는다.
  return { tables: [...ordered, ...views], deferred }
}

/** 미뤄 둔 FK 하나를 거는 ALTER 문. */
function alterAddFk(d: DialectId, t: TableDef, k: Constraint, qualify: boolean): string {
  const cols = resolveColumns(t, k)
    .map((c) => quoteId(d, c.name))
    .join(', ')
  const refCols = (k.refColumns ?? []).map((c) => quoteId(d, c)).join(', ')
  const refSchema = k.refSchema ?? t.schema
  const ref =
    qualify && refSchema && d !== 'sqlite'
      ? `${quoteId(d, refSchema)}.${quoteId(d, k.refTable ?? '?')}`
      : quoteId(d, k.refTable ?? '?')
  let sql =
    `ALTER TABLE ${qualifiedTable(d, t, qualify)} ADD CONSTRAINT ${quoteId(d, k.name)}` +
    ` FOREIGN KEY (${cols}) REFERENCES ${ref} (${refCols})`
  if (k.onDelete) sql += ` ON DELETE ${k.onDelete}`
  if (k.onUpdate) sql += ` ON UPDATE ${k.onUpdate}`
  return `${sql};`
}

/**
 * 스키마 전체 DDL 스크립트 — 위에서 아래로 그대로 실행하면 스키마가 선다.
 * 테이블 사이는 빈 줄로만 가른다(`-- 테이블명` 머리 주석은 바로 아래 CREATE 문이 이미 말한다).
 */
export function generateSchemaScript(tables: TableDef[], dialect: DialectId): string {
  // 스키마가 둘 이상일 때만 한정 이름을 쓴다 — 하나뿐이면 예전 스크립트와 글자가 같아야 한다.
  const qualify = hasMultipleSchemas(tables)
  const { tables: ordered, deferred } = orderForCreate(tables, dialect)
  const blocks: string[] = []

  // 테이블보다 스키마가 먼저 서야 한다. SQLite 는 스키마 개념이 없어 아무것도 안 붙인다.
  if (qualify && dialect !== 'sqlite') {
    const head = dialect === 'postgresql' ? 'CREATE SCHEMA IF NOT EXISTS' : 'CREATE DATABASE IF NOT EXISTS'
    const created = groupBySchema(tables)
      .map((g) => g.schema)
      // 기본 스키마는 만들지 않는다 — PostgreSQL `public` 은 언제나 있고, MySQL 에선 연결이 이미 붙어 있다.
      .filter((name) => name && name !== DEFAULT_SCHEMA)
      .map((name) => `${head} ${quoteId(dialect, name)};`)
    if (created.length > 0) blocks.push(created.join('\n'))
  }

  blocks.push(...ordered.map((t) => generateDdl(t, dialect, { qualify })))
  if (deferred.length > 0) {
    blocks.push(
      [
        '-- 서로 맞물려 참조하는 테이블들 — 위 CREATE 에서 뺀 외래키를 여기서 건다.',
        ...deferred.map(({ table, constraint }) => alterAddFk(dialect, table, constraint, qualify))
      ].join('\n')
    )
  }
  return blocks.join('\n\n')
}
