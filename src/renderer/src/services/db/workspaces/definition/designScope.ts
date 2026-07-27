import type { Column, Constraint, TableDef } from './types'

/** 저장소 레코드(preload TableRecord)에서 필요한 필드만 — 매퍼가 preload 를 import 하지 않게. */
interface TableRecordLike {
  id: string
  designId: string
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
    name: r.name,
    comment: r.comment,
    columns: r.columns as Column[],
    constraints: r.constraints as Constraint[],
    isView: r.isView ?? false,
    viewSql: r.viewSql ?? ''
  }
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
