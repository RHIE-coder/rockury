import { refTarget, referencingFks, sameTable, type TableRef } from '@shared/db/tableRef'
import type { Constraint, TableDef } from './workspaces/definition/types'

/**
 * 스키마 한정 참조 — **테이블을 이름으로 찾는 일은 전부 여기를 거친다.**
 *
 * 왜 한 곳으로 모으나: 예전 코드는 FK 대상을 `tables.find(t => t.name === refTable)` 로 찾았다.
 * 스키마가 하나뿐일 땐 맞았지만, 범위(scope)를 켜서 `public` 과 `auth` 를 같이 보는 순간
 * 두 스키마에 같은 이름 테이블이 있으면 **조용히 엉뚱한 테이블에 붙는다** — 그리고 그 오염이
 * ERD 선·Migration diff 까지 번진다. 오류가 안 나고 결과만 틀리는 종류라 눈으로는 못 잡는다.
 * 그래서 찾는 규칙을 한 함수로 두고, 화면들은 그것만 부른다.
 *
 * 규칙: **스키마가 비면 "같은 스키마"** 다. 예전 데이터와 단일 스키마 사용자는 양쪽 다 비어 있어
 * 그대로 맞아떨어진다(값을 채워 넣는 마이그레이션 없이도 동작이 안 바뀐다).
 */

/**
 * 기본 스키마 이름은 **여기 없다.** 예전에는 `DEFAULT_SCHEMA = 'public'` 하나를 방언과 무관하게
 * 썼는데, MySQL 에는 `public` 이라는 데이터베이스가 없어서 MySQL 설계가 존재하지 않는 이름을
 * 들고 있었다(2026-08-11 사용자 지적). 이름을 정하는 일은 방언을 봐야 하므로
 * `schemaCatalog.suggestSchemaName(dialect, …)` 이 맡고, 설계가 실제로 든 이름은
 * `design.declaredSchemas` 에 남는다. 이 파일은 **이름을 지어내지 않고 비교만 한다.**
 */

/*
 * 비교 규칙 자체(`TableRef`·`sameTable`·`refTarget`)는 **여기 없다** — `@shared/db/tableRef` 가
 * 든다. 메인의 MCP 쓰기 관문이 같은 규칙을 써야 해서다(사본을 두면 한쪽만 고쳐진다).
 * 화면 쪽 편의(이름 표기·묶기·목록에서 찾기)만 이 파일에 남는다.
 */
export { sameTable, refTarget, type TableRef }

/** 스키마가 비었을 때 대신 쓸 이름 — 화면·비교에서 `undefined` 와 `''` 를 같게 다루기 위한 것. */
const norm = (schema: string | undefined): string => schema ?? ''

/**
 * `스키마.테이블` 한정 이름. 스키마가 없으면 이름만 — 단일 스키마 화면에서 `.` 이 붙지 않는다.
 * 사람에게 보이는 글자이자 지도(Map) 키로도 쓴다(같은 규칙 하나로 붙었다 떨어졌다 하지 않게).
 */
export function qualifiedName(t: TableRef): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name
}

/**
 * FK 가 가리키는 테이블을 목록에서 찾는다. 못 찾으면 `undefined` — **그것이 곧 "범위 밖"** 이다
 * (다른 스키마를 안 켰거나, 다른 카탈로그·다른 연결에 있는 테이블).
 * `refSchema` 가 비면 FK 가 걸린 테이블과 같은 스키마에서 찾는다.
 */
export function resolveRef(
  tables: readonly TableDef[],
  from: TableRef,
  con: Pick<Constraint, 'refTable' | 'refSchema'>
): TableDef | undefined {
  if (!con.refTable) return undefined
  const target: TableRef = { schema: con.refSchema ?? from.schema, name: con.refTable }
  return tables.find((t) => sameTable(t, target))
}

/**
 * `target` 을 **가리키는** FK 들 — `resolveRef` 의 반대 방향(누가 나를 참조하나).
 * 자기참조도 들어온다 — 빼려면 부르는 쪽에서 거른다.
 */
export function referencingTables(
  tables: readonly TableDef[],
  target: TableRef
): { table: TableDef; constraint: Constraint }[] {
  return referencingFks(tables, (t) => t.constraints, target)
}

/** 목록에 스키마가 둘 이상 섞여 있나 — 화면이 이름 앞에 스키마를 붙일지 정하는 기준. */
export function hasMultipleSchemas(tables: readonly TableRef[]): boolean {
  const seen = new Set<string>()
  for (const t of tables) {
    seen.add(norm(t.schema))
    if (seen.size > 1) return true
  }
  return false
}

/**
 * 화면에 쓸 이름 — 스키마가 하나뿐이면 이름만, 여럿이 섞여 있으면 `스키마.이름`.
 * 늘 붙이면 단일 스키마 사용자에게 시끄럽고, 안 붙이면 같은 이름 둘이 구분되지 않는다.
 */
export function displayName(t: TableRef, multiSchema: boolean): string {
  return multiSchema ? qualifiedName(t) : t.name
}

/** 스키마별로 묶는다(스키마 이름순, 안은 들어온 순서 유지). 스키마 없는 것은 맨 앞. */
export function groupBySchema<T extends TableRef>(tables: readonly T[]): { schema: string; tables: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const t of tables) {
    const key = norm(t.schema)
    const bucket = groups.get(key)
    if (bucket) bucket.push(t)
    else groups.set(key, [t])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([schema, list]) => ({ schema, tables: list }))
}
