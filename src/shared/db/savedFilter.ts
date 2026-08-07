/**
 * 저장 필터(§db-remote.data.saved-filter) — 메인·프리로드·렌더러가 함께 쓰는 모양.
 *
 * 필터 조건의 모양(`Filter`·`FilterOp`)도 여기 둔다. 예전엔 렌더러의 `remote/data/sqlBuilder`
 * 안에만 있었는데, 저장 필터가 생기면서 저장소(main)까지 같은 모양을 알아야 해졌다.
 * 두 벌로 적으면 연산자를 하나 더할 때 한쪽만 고쳐진다 — `sqlBuilder` 는 여기서 다시 내보낸다.
 */

/** 필터 연산자 — 값 없는 IS NULL / IS NOT NULL 포함. */
export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL'

export const FILTER_OPS: FilterOp[] = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'IS NULL',
  'IS NOT NULL'
]

/** 값 칸이 필요 없는 연산자 — 화면은 값 입력을 감추고, SQL 은 바인드 값을 넣지 않는다. */
export const NO_VALUE_OPS: FilterOp[] = ['IS NULL', 'IS NOT NULL']

export interface Filter {
  column: string
  op: FilterOp
  value: string
}

/**
 * 저장된 조건 묶음 하나. 주인은 `연결 · 스키마 · 표 이름` 셋이다 — 이름만으로 가르면
 * 범위에 스키마가 둘 이상 켜져 있을 때 `service1.users` 와 `service2.users` 의 필터가 섞인다
 * (§db/schemaRef 와 같은 이유). 스키마가 빈 문자열이면 "기본 스키마"다.
 */
export interface SavedFilterRecord {
  id: string
  connectionId: string
  schema: string
  table: string
  name: string
  filters: Filter[]
  createdAt: string
  updatedAt: string
}

/** 저장·수정 입력. `id` 가 있으면 그 항목을 고치고, 없으면 새로 만든다. */
export interface SaveFilterInput {
  id?: string
  connectionId: string
  schema: string
  table: string
  name: string
  filters: Filter[]
}
