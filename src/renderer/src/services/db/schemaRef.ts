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
 * 설계부의 기본 스키마 — 스키마를 안 적은 테이블이 올라갈 자리(2026-07-30 사용자 결정).
 * PostgreSQL 의 기본 스키마 이름을 그대로 쓴다. 설계에 스키마가 이것 하나뿐이면 DDL 은
 * 한정 이름을 안 쓰므로, 단일 스키마 설계의 출력은 이 값이 무엇이든 안 바뀐다.
 */
export const DEFAULT_SCHEMA = 'public'

/** 테이블을 가리키는 최소 정보. TableDef 도 이 모양을 만족한다. */
export interface TableRef {
  schema?: string
  name: string
}

/** 스키마가 비었을 때 대신 쓸 이름 — 화면·비교에서 `undefined` 와 `''` 를 같게 다루기 위한 것. */
const norm = (schema: string | undefined): string => schema ?? ''

/** 같은 테이블인가 — 스키마까지 본다. 둘 다 스키마가 비면 같은 스키마로 친다. */
export function sameTable(a: TableRef, b: TableRef): boolean {
  return a.name === b.name && norm(a.schema) === norm(b.schema)
}

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

/** FK 가 가리키는 대상을 (스키마, 이름) 으로 편다 — 목록에 없어도 무엇을 가리키는지는 안다. */
export function refTarget(
  from: TableRef,
  con: Pick<Constraint, 'refTable' | 'refSchema'>
): TableRef | undefined {
  if (!con.refTable) return undefined
  return { schema: con.refSchema ?? from.schema, name: con.refTable }
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
