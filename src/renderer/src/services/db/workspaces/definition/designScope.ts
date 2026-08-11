import { scopeTableIds } from '../../migration/importSchema'
import { suggestSchemaName, supportsSchemas } from '@shared/db/schemaCatalog'
import type { DialectId } from '../../dialects'
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
    /**
     * 스키마는 **저장된 그대로** 둔다. 비면 비운다.
     *
     * 예전에는 여기서 빈 스키마를 `public` 으로 채웠다(2026-07-30). 그 값이 방언을 안 봐서
     * MySQL 설계가 있지도 않은 `public` 을 들고 있었고, Migration 이 `(스키마, 이름)` 으로 짝을
     * 찾다 하나도 못 맞춰 "실 DB 전부 삭제"를 계획할 수 있었다(2026-08-11 사용자 지적).
     * 모르는 것은 모르는 채로 두는 편이 낫다 — `schemaRef` 가 빈 스키마를 "같은 스키마"로
     * 다루고, `align.ts` 는 이름만으로 짝을 찾아 실 DB 쪽 스키마를 물려받는다. 이름을 정하는
     * 일은 **선언**(`design.declaredSchemas`)과 `newTableSchema` 의 몫이다.
     */
    schema: r.schema || undefined,
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
 * 설계에서는 `테이블 추가`·`뷰 추가` 를 눌러도 **저장만 되고 아무것도 안 떴다**
 * (2026-08-04 사용자 제보 · 실측 재현).
 *
 * 정하는 순서:
 *  1. **고른 범위의 첫 스키마** — 지금 보고 있는 자리에 생겨야 누른 사람 눈에 보인다.
 *  2. **설계가 선언한 첫 스키마** — 사람이 "이 설계는 여기다"라고 정해 둔 자리다.
 *  3. 선언이 없고 **실제로 쓰는 스키마가 하나뿐**이면 그것 — 엉뚱한 묶음을 새로 만들지 않는다.
 *  4. 그래도 못 정하면 방언의 기본값. 방언에 스키마 층이 없으면(sqlite) 빈 이름이다 —
 *     예전처럼 `public` 을 지어내지 않는다(2026-08-11).
 */
export function newTableSchema(input: {
  scope: readonly string[]
  declared: readonly string[]
  used: readonly string[]
  dialect: DialectId
  designName: string
}): string {
  const { scope, declared, used, dialect, designName } = input
  if (scope.length > 0) return scope[0]
  if (declared.length > 0) return declared[0]
  if (used.length === 1) return used[0]
  if (!supportsSchemas(dialect)) return ''
  return suggestSchemaName(dialect, designName)
}

/**
 * **새로 만드는 표·뷰가 태어날 이름**(순수) — `new_table_1` · `new_view_1` …
 *
 * 사람이 보는 번호는 **내부 id 번호와 따로 센다.** 예전엔 둘이 같은 카운터(`seq`)를 나눠 써서,
 * 한 번 만들 때 id 가 한 칸·이름이 한 칸씩 먹었다. 그래서 뷰를 서른한 번 만들면 이름이
 * `new_view_2, 4, 6 … 62` 로 나왔다 — 쓰는 사람 눈에는 홀수가 통째로 사라진 것으로 보인다
 * (2026-08-05 사용자 제보 · 실 DB 에서 31개 확인). 표는 더 심해서 컬럼·제약 id 까지 같은
 * 카운터를 먹는 바람에 이름이 세 칸씩 뛰었다.
 *
 * 이 설계 안에서 **같은 접두를 쓰는 이름의 최대 번호 + 1**을 쓴다. 그래서
 *  · 번호가 1부터 빈틈없이 이어지고,
 *  · 다 지우면 다시 1부터 시작하며,
 *  · 사람이 손으로 바꾼 이름(`orders` 등)은 세지 않아 방해하지 않는다.
 */
export function nextNewName(
  tables: readonly TableDef[],
  designId: string,
  prefix: 'new_table' | 'new_view'
): string {
  const re = new RegExp(`^${prefix}_(\\d+)$`)
  let max = 0
  for (const t of tables) {
    if (t.designId !== designId) continue
    const m = re.exec(t.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}_${max + 1}`
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
