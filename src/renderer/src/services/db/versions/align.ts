import type { Constraint, TableDef } from '../workspaces/definition/types'
import type { VersionSnapshot } from './store'

/**
 * 설계↔실DB 경계 정렬(§열린 질문 해소) — 비교(diff/plan) **직전에만** 쓰는 순수 함수.
 *
 * 문제: diff/generateMigration 은 id 완전일치로 짝을 짓는데, Studio 저작 설계는 순번 id(`o1`),
 * 역설계(introspection)는 이름 기반 id(`t:orders`)라 경계를 넘으면 같은 테이블이
 * "전부 삭제 + 전부 추가"로 오판된다. 실 DB 엔 순번 id 가 존재하지 않으므로(이름이 곧 정체성),
 * 경계 비교에선 설계쪽 id 를 이름 기반 스킴으로 재계산해 짝이 맞게 한다.
 *
 * 적용 범위: 실 DB 가 끼는 비교(Drift·가져오기 version-up·Plan)에만.
 * 같은 설계 계보의 버전끼리 비교(Version Diff)는 순번 id 로 rename 을 추적해야 하므로 여기를 타지 않는다.
 * 저장 데이터는 불변 — 비교 시점의 사본만 바꾼다.
 *
 * 제약(constraint)은 이름이 아니라 **구조 시그니처**(종류+컬럼 구성+참조)로 짝을 짓는다 —
 * DB 가 제약 이름을 제멋대로 정규화하기 때문(예: MySQL PK 는 항상 `PRIMARY`).
 * 구조가 같으면 실DB쪽 id·이름을 입양해 라벨 차이를 소음에서 제거한다.
 */

// 이름 기반 id 스킴 — console/introspection.ts 와 동일해야 짝이 맞는다.
const tableId = (t: string): string => `t:${t}`
const columnId = (t: string, c: string): string => `c:${t}.${c}`
const keyId = (t: string, name: string): string => `k:${t}.${name}`

/** 제약 구조 시그니처 — 이름 제외(라벨은 DB 가 바꿔치기하므로), 컬럼은 "이름+방향" 순서열로. */
function constraintSignature(con: Constraint, cols: TableDef['columns']): string {
  const colNames = con.columns.map((r) => {
    const name = cols.find((c) => c.id === r.columnId)?.name ?? '?'
    return `${name}:${r.direction ?? 'ASC'}`
  })
  return JSON.stringify([
    con.kind,
    colNames,
    con.refTable ?? '',
    con.refColumns ?? [],
    con.onDelete ?? '',
    con.onUpdate ?? '',
    con.expression ?? ''
  ])
}

/**
 * design 스냅샷의 id 를 actual(역설계) 스킴에 맞춰 재계산한 사본을 반환.
 * 이름이 같은 테이블·컬럼은 자동으로 id 가 일치하고, 구조가 같은 제약은 actual 의 id·이름을 입양한다.
 * actual 에 없는 것들도 이름 기반 id 로 바뀌므로 diff 에는 정직하게 추가/삭제로 남는다.
 */
export function alignSnapshotToActual(design: VersionSnapshot, actual: VersionSnapshot): VersionSnapshot {
  const actualByName = new Map(actual.tables.map((t) => [t.name, t]))
  const usedTableIds = new Set<string>()

  const tables = design.tables.map((t): TableDef => {
    // 테이블 — 이름 기반 id. 같은 이름이 중복되면(비정상 편집 상태) 뒤엣것은 원 id 유지(충돌 방지).
    let tid = tableId(t.name)
    if (usedTableIds.has(tid)) tid = t.id
    usedTableIds.add(tid)

    // 컬럼 — 이름 기반 id + 옛→새 매핑(제약의 컬럼 참조 갱신용). 중복 이름은 원 id 유지.
    const usedColIds = new Set<string>()
    const colIdMap = new Map<string, string>()
    const columns = t.columns.map((c) => {
      let cid = columnId(t.name, c.name)
      if (usedColIds.has(cid)) cid = c.id
      usedColIds.add(cid)
      colIdMap.set(c.id, cid)
      return { ...c, id: cid }
    })

    // 제약 — 같은 이름 테이블이 actual 에 있으면 구조 시그니처로 짝을 찾아 id·이름 입양.
    const actualTable = actualByName.get(t.name)
    const actualBySig = new Map<string, Constraint[]>()
    if (actualTable) {
      for (const ak of actualTable.constraints) {
        const sig = constraintSignature(ak, actualTable.columns)
        ;(actualBySig.get(sig) ?? actualBySig.set(sig, []).get(sig)!).push(ak)
      }
    }
    const constraints = t.constraints.map((k): Constraint => {
      const remapped: Constraint = {
        ...k,
        columns: k.columns.map((r) => ({ ...r, columnId: colIdMap.get(r.columnId) ?? r.columnId }))
      }
      const sig = constraintSignature(k, t.columns) // 시그니처는 원본 컬럼 목록으로(이름만 쓰므로 동일)
      const candidates = actualBySig.get(sig)
      const adopted = candidates?.shift() // 같은 구조가 여럿이면 하나씩 소비(이중 입양 방지)
      if (adopted) return { ...remapped, id: adopted.id, name: adopted.name }
      return { ...remapped, id: keyId(t.name, k.name) }
    })

    return { ...t, id: tid, columns, constraints }
  })

  return { tables }
}
