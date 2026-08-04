import { scopeTableIds } from '../../migration/importSchema'
import { DEFAULT_SCHEMA } from '../../schemaRef'
import type { Column, Constraint, TableDef } from './types'

/** 저장소 레코드(preload TableRecord)에서 필요한 필드만 — 매퍼가 preload 를 import 하지 않게. */
interface TableRecordLike {
  id: string
  designId: string
  schema?: string
  name: string
  comment: string
  columns: unknown[]
  constraints: unknown[]
  isView?: boolean
  viewSql?: string
}

/**
 * 저장소 레코드 → 렌더러 도메인 TableDef. init(최초 하이드레이션)과 rehydration(에이전트발 갱신)이
 * 같은 매핑을 써야 형태가 어긋나지 않는다 — 한 곳에 둔다(형제 store 의 toDef 관례와 맞춤).
 */
export function toTableDef(r: TableRecordLike): TableDef {
  return {
    id: r.id,
    designId: r.designId,
    // 스키마를 안 적은 행은 **기본 스키마**로 올린다(2026-07-30 사용자 결정: `public` 고정).
    // 여기서 채워 두면 설계 전체가 한 스키마로 통일돼, 단일 스키마 설계의 DDL 은 예전과
    // 글자 하나까지 같다(스키마가 하나뿐이면 한정 이름을 안 쓴다 — `db-design.definition.sql`).
    schema: r.schema || DEFAULT_SCHEMA,
    name: r.name,
    comment: r.comment,
    columns: r.columns as Column[],
    constraints: r.constraints as Constraint[],
    isView: r.isView ?? false,
    viewSql: r.viewSql ?? ''
  }
}

/** 저장으로 내보낼 필드만 — preload `TableRecord` 의 부분집합(preload 를 import 하지 않으려고). */
interface TableRecordOut {
  id: string
  designId: string
  schema?: string
  name: string
  comment: string
  columns: unknown[]
  constraints: unknown[]
  isView: boolean
  viewSql: string
}

/**
 * 렌더러 도메인 TableDef → 저장소 레코드. **`toTableDef` 의 짝**이다.
 *
 * 짝이 없던 동안 저장 쪽에서 `schema` 가 통째로 빠져 있었다(2026-08-03 실측): 여러 스키마를
 * 가져온 설계도 화면이 한 번 저장하는 순간 전부 기본 스키마로 뭉개졌고, 앱을 다시 열면
 * `auth.sessions` 가 `public.sessions` 로 보였다. 내보낼 필드를 한 곳에 모아 다시 어긋나지 않게 한다.
 */
export function toTableRecord(t: TableDef): TableRecordOut {
  return {
    id: t.id,
    designId: t.designId,
    schema: t.schema,
    name: t.name,
    comment: t.comment,
    columns: t.columns,
    constraints: t.constraints,
    isView: t.isView ?? false,
    viewSql: t.viewSql ?? ''
  }
}

/**
 * 커밋된 버전 스냅샷을 **Draft 로 앉힐 형태**로 바꾼다.
 *
 * id 규칙이 스냅샷마다 다른 것이 까다롭다. 설계부에서 컷한 버전은 Draft 의 id 를 그대로 담아
 * 이미 `<설계>:` 접두가 붙어 있고, 운영 DB 가져오기로 컷한 버전은 실 DB 이름 기반(`t:public.users`)
 * 이라 접두가 없다. Draft 는 전역 `tables` 테이블(PK=id)에 들어가므로 접두가 **꼭 한 번** 필요하다 —
 * 없으면 다른 설계와 부딪히고, 두 번 붙으면 같은 테이블이 새것으로 둔갑한다. 그래서 테이블마다
 * 접두 여부를 보고 없는 것에만 붙인다(순서는 그대로 — 목록 차례가 뒤집히면 안 된다).
 */
export function draftTablesFromSnapshot(tables: readonly TableDef[], designId: string): TableDef[] {
  const prefix = `${designId}:`
  return tables.map((t) => {
    const owned = t.designId === designId ? t : { ...t, designId }
    return owned.id.startsWith(prefix) ? owned : scopeTableIds([owned], designId)[0]
  })
}

/**
 * 설계 스코프 저장/리하이드레이션의 순수 로직 — store.ts 의 구독 글루에서 분리해 테스트한다.
 * (저장 단위가 설계로 좁혀진 이유: 에이전트(MCP)와 화면이 서로 다른 설계를 동시에 만져도
 *  낡은 사본이 상대를 되덮지 않게 — spec ai-server tools.write AC-4.)
 */

/**
 * prev→next 에서 내용이 바뀐 설계 id 목록.
 * 스토어 갱신은 바뀐 객체만 새로 만들므로 참조 비교로 충분하다.
 * 어떤 설계의 항목이 전부 사라진 경우(비우기·설계 삭제 연쇄)도 "바뀜"에 포함된다.
 * (테이블뿐 아니라 시드 세트 등 **설계 소속 목록 전부**가 같은 판정을 쓴다 — 중복 구현 금지.)
 */
export function changedDesignIds<T extends { designId: string }>(prev: T[], next: T[]): string[] {
  if (prev === next) return []
  const group = (list: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    for (const t of list) {
      const arr = m.get(t.designId)
      if (arr) arr.push(t)
      else m.set(t.designId, [t])
    }
    return m
  }
  const a = group(prev)
  const b = group(next)
  const changed: string[] = []
  for (const [id, list] of b) {
    const old = a.get(id)
    if (!old || old.length !== list.length || list.some((item, i) => item !== old[i])) changed.push(id)
  }
  for (const id of a.keys()) if (!b.has(id)) changed.push(id)
  return changed
}

/** 리하이드레이션 병합 — 대상 설계 슬라이스만 저장소 값으로 갈아끼우고 다른 설계는 보존. */
export function mergeDesignTables(current: TableDef[], designId: string, incoming: TableDef[]): TableDef[] {
  return [...current.filter((t) => t.designId !== designId), ...incoming.filter((t) => t.designId === designId)]
}

/**
 * **새로 만드는 표·뷰가 태어날 스키마**(순수).
 *
 * 만드는 쪽에 이 기본값이 없던 동안 새 표·뷰는 스키마 없이 태어났고, 화면 목록·다이어그램은
 * 스키마 범위로 거르면서 `스키마가 있고 && 고른 범위에 든다` 를 요구했다 — 그래서 범위를 켠
 * 설계에서는 `테이블 추가`·`뷰 추가` 를 눌러도 **저장만 되고 아무것도 안 떴다**. 앱을 다시 열면
 * 불러오는 쪽(`toTableDef`)이 빈 스키마를 기본값으로 채워 그제서야 나타났다
 * (2026-08-04 사용자 제보 · 실측 재현).
 *
 * 정하는 순서:
 *  1. **고른 범위의 첫 스키마** — 지금 보고 있는 자리에 생겨야 누른 사람 눈에 보인다.
 *  2. 범위를 안 골랐고 **설계가 실제로 쓰는 스키마가 하나뿐**이면 그것 — 단일 스키마 설계에
 *     엉뚱한 묶음을 새로 만들지 않는다.
 *  3. 그래도 못 정하면 기본 스키마(`toTableDef` 의 폴백과 같은 값이라 만들기·불러오기가 안 어긋난다).
 */
export function newTableSchema(scope: readonly string[], used: readonly string[]): string {
  if (scope.length > 0) return scope[0]
  if (used.length === 1) return used[0]
  return DEFAULT_SCHEMA
}

/**
 * 리하이드레이션 후 활성 테이블 재조정 판정(순수).
 * 편집 중이던 활성 테이블이 에이전트 쓰기로 사라지면 activeTableId 가 죽은 id 로 남아
 * 이후 편집 액션이 조용히 no-op 이 된다 — 사라졌으면 갱신된 그 설계의 첫 테이블로 되돌린다.
 */
export function reconcileActiveTable(
  currentActiveId: string,
  merged: TableDef[],
  incoming: TableDef[]
): { changed: boolean; activeTableId: string } {
  if (!currentActiveId || merged.some((t) => t.id === currentActiveId))
    return { changed: false, activeTableId: currentActiveId }
  return { changed: true, activeTableId: incoming[0]?.id ?? '' }
}
