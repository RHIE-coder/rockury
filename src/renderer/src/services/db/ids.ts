/**
 * 이름 기반 id 스킴 — **역설계(`remote/introspection`)와 스냅샷 정렬(`versions/align`)이
 * 반드시 같은 글자를 만들어야 한다.** 두 곳에 따로 적어 두었더니 한쪽만 고쳐져 어긋났다.
 * 그래서 한 모듈로 모은다.
 *
 * 규칙 둘:
 *  - **스키마가 있으면 앞에 붙이고, 없으면 통째로 뺀다.** 예전 데이터(스키마 없음)의 id 가
 *    글자 하나도 안 바뀌어야 저장된 스냅샷·배치가 그대로 붙는다.
 *  - **제약 id 에는 종류가 들어간다.** MySQL 은 FK 를 만들 때 같은 이름의 인덱스를 함께 만들어,
 *    이름만으로는 FK 와 인덱스가 같은 id 가 된다(실측: `k:testdb.api_keys.fk_api_keys_user` 중복 →
 *    화면이 React key 중복으로 하나를 삼켰다).
 */

const prefix = (schema: string | undefined): string => (schema ? `${schema}.` : '')

export const tableId = (schema: string | undefined, table: string): string =>
  `t:${prefix(schema)}${table}`

export const columnId = (schema: string | undefined, table: string, column: string): string =>
  `c:${prefix(schema)}${table}.${column}`

export const constraintId = (
  schema: string | undefined,
  table: string,
  kind: string,
  name: string
): string => `k:${prefix(schema)}${table}.${kind}.${name}`
