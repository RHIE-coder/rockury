import { copyName } from '../../copyName'
import { qualifiedName, refTarget, resolveRef, sameTable, type TableRef } from '../../schemaRef'
import type { Constraint, TableDef } from '../definition/types'

/**
 * 다른 설계(다이어그램)의 테이블을 이 설계로 **복제**하는 순수 계산.
 *
 * ⚠ 복제이지 동기화가 아니다 — 한 번 떠 오면 원본과의 줄은 끊긴다. 이후 원본이 바뀌어도
 * 따라오지 않고, 여기서 고쳐도 원본은 안 바뀐다(2026-08-02 사용자 확인).
 *
 * 어려운 곳은 셋이고, 셋 다 "오류 없이 결과만 틀리는" 종류라 여기 모아 테스트로 못 박는다:
 *  1. **id** — 저장소 `tables` 의 PK 는 설계 무관 전역 id 다. 원본 id 를 그대로 들고 오면
 *     같은 id 행이 둘이 된다 → 새로 발급한다(발급기는 번호 권한을 가진 definition 스토어가 넣어 준다).
 *  2. **FK 대상** — FK 는 id 가 아니라 **이름**으로 건다(`refTable`/`refSchema`). 그래서 이름이
 *     겹쳐 복제본이 새 이름을 받으면 참조도 같이 고쳐야 한다. 안 고치면 복제본의 FK 가
 *     조용히 **받는 설계의 원래 테이블**을 가리킨다.
 *  3. **끊긴 참조** — 대상을 안 가져와 허공을 가리키게 된 FK 는 뺀다. 다만 **출처에서도 이미
 *     허공이던 FK 는 그대로 옮긴다** — 원본에 없던 손질을 우리가 하지 않는다.
 */

/** 이름이 겹칠 때 — 복사본 이름을 새로 주거나(rename), 그 테이블을 건너뛴다(skip). */
export type CollisionMode = 'rename' | 'skip'

export interface CopyInput {
  /** 출처 목록 전체(그 설계의 Draft 또는 한 버전 스냅샷) — FK 대상을 찾는 모집단. */
  source: readonly TableDef[]
  /** 사람이 고른 테이블 id. */
  picked: readonly string[]
  /** 받는 설계에 이미 있는 테이블 — 이름 충돌 판정의 기준. */
  existing: readonly TableDef[]
  /** FK 로 엮인 테이블도 함께 가져올 것인가. */
  withRelated: boolean
  onCollision: CollisionMode
  /** 받는 설계 id. */
  designId: string
  /**
   * 받는 스키마 — **어느 칸에 넣을지**. `undefined` 면 출처의 칸을 그대로 쓴다.
   *
   * 왜 필요한가: 받는 설계가 칸으로 나뉘어 있는데(`service1`·`service2`…) 출처가 칸 없는
   * 설계면, 그대로 옮긴 표들이 어느 칸에도 안 들어가 **다섯 번째 무리**로 따로 앉는다.
   * 그리고 칸이 다르면 겹침으로 안 세므로 한 설계에 같은 이름 표가 둘 생긴다
   * (2026-08-20 사용자 화면: `service2.orders` 가 있는데 칸 없는 `orders` 가 또 들어왔다).
   *
   * 빈 문자열은 "칸 없음"이다 — `undefined`(출처 그대로)와 뜻이 다르다.
   */
  intoSchema?: string
  /** 새 id 발급기 — 테스트는 결정적 발급기를 넣는다. */
  mintId: (prefix: 'tbl' | 'col' | 'con') => string
}

/** 복제 대상 한 줄 — 화면이 목록에 그대로 그린다. */
export interface CopyEntry {
  /** 출처 테이블 id. */
  id: string
  schema?: string
  /** 출처 이름. */
  name: string
  /** 받는 설계에서 쓸 이름 — 겹쳐서 바뀌었으면 다르다. */
  finalName: string
  /** 사람이 고른 게 아니라 FK 때문에 딸려온 것. */
  related: boolean
  /** 이름이 겹쳐 건너뛴다(skip 모드) — 복제되지 않는다. */
  skipped: boolean
}

/** FK 한 줄의 뒷이야기 — 화면이 "이건 알고 넘어가라"고 말할 거리. */
export interface FkNote {
  /** FK 가 걸린(복제본) 테이블 이름. */
  table: string
  constraint: string
  /** 가리키던 대상의 한정 이름. */
  target: string
}

export interface CopyResult {
  entries: CopyEntry[]
  /** 대상을 안 가져와 빼 버린 FK. */
  droppedFks: FkNote[]
  /** 받는 설계에 이미 있던 같은 이름 테이블에 이어붙은 FK — 의도한 것인지 사람이 봐야 한다. */
  linkedFks: FkNote[]
  /** 그대로 `tables` 에 이어 붙이면 되는 복제본. */
  tables: TableDef[]
}

/**
 * FK 로 엮인 테이블까지 넓힌 선택(전이 포함). 출처 목록 순서를 지킨다 —
 * 화면 목록이 고를 때마다 뒤섞이면 무엇이 딸려왔는지 눈으로 못 쫓는다.
 */
export function relatedClosure(source: readonly TableDef[], picked: readonly string[]): string[] {
  const byId = new Map(source.map((t) => [t.id, t]))
  const chosen = new Set(picked.filter((id) => byId.has(id)))
  const queue = [...chosen]
  while (queue.length > 0) {
    const table = byId.get(queue.shift()!)!
    for (const con of table.constraints) {
      if (con.kind !== 'fk') continue
      const target = resolveRef(source, table, con)
      if (!target || chosen.has(target.id)) continue
      chosen.add(target.id)
      queue.push(target.id)
    }
  }
  return source.filter((t) => chosen.has(t.id)).map((t) => t.id)
}

/** 스키마+이름 한 쌍의 지도 키 — 스키마 없음(`undefined`)과 빈 문자열을 같게 다룬다. */
const nameKey = (t: TableRef): string => `${t.schema ?? ''}\u0000${t.name}`

export function buildCopy(input: CopyInput): CopyResult {
  const { source, existing, withRelated, onCollision, designId, mintId, intoSchema } = input
  const pickedSet = new Set(input.picked)
  const chosenIds = withRelated
    ? relatedClosure(source, input.picked)
    : source.filter((t) => pickedSet.has(t.id)).map((t) => t.id)
  const byId = new Map(source.map((t) => [t.id, t]))
  const chosen = chosenIds.map((id) => byId.get(id)!)

  // 이번 배치에서 이미 정해진 이름도 "쓰인 이름"이다 — 복제본 둘이 같은 새 이름을 받으면
  // 저장은 되고 DDL 에서만 터진다.
  const assigned = new Set<string>()
  const isTaken = (ref: TableRef): boolean =>
    existing.some((t) => sameTable(t, ref)) || assigned.has(nameKey(ref))

  /** 이 표가 **떨어질 자리**의 스키마. 빈 문자열은 "칸 없음"으로 접는다. */
  const destSchema = (t: TableRef): string | undefined =>
    intoSchema === undefined ? t.schema : intoSchema || undefined

  /*
   * 겹침은 **떨어질 자리에서** 본다 — 옮겨 넣기로 했으면 거기 있는 이름과 부딪히는 것이 맞다.
   * 출처 자리에서 보면 `service2` 로 넣는데 `service2.orders` 를 못 보고 지나친다.
   */
  const entries: CopyEntry[] = chosen.map((t) => {
    const schema = destSchema(t)
    const base = { id: t.id, schema, name: t.name, related: !pickedSet.has(t.id) }
    if (!isTaken({ schema, name: t.name })) {
      assigned.add(nameKey({ schema, name: t.name }))
      return { ...base, finalName: t.name, skipped: false }
    }
    if (onCollision === 'skip') return { ...base, finalName: t.name, skipped: true }
    const finalName = copyName(t.name, (name) => isTaken({ schema, name }))
    assigned.add(nameKey({ schema, name: finalName }))
    return { ...base, finalName, skipped: false }
  })

  const copied = entries.filter((e) => !e.skipped)
  /*
   * FK 를 다시 걸 때 쓰는 지도는 **출처 자리**를 열쇠로 삼는다 — FK 가 가리키는 대상은 출처
   * 이름으로 적혀 있어서, 목적지 자리로 키를 만들면 옮겨 넣는 순간 하나도 못 찾는다.
   */
  const copiedBySourceKey = new Map(copied.map((e) => [nameKey(byId.get(e.id)!), e]))

  const droppedFks: FkNote[] = []
  const linkedFks: FkNote[] = []
  const tables: TableDef[] = []

  for (const entry of copied) {
    const t = byId.get(entry.id)!
    const tableId = mintId('tbl')
    const colIds = new Map<string, string>()
    const columns = t.columns.map((c) => {
      const id = mintId('col')
      colIds.set(c.id, id)
      return { ...c, id }
    })

    const constraints: Constraint[] = []
    for (const con of t.constraints) {
      const next: Constraint = {
        ...con,
        id: mintId('con'),
        // 제약·인덱스 이름은 관례상 테이블 이름을 품는다(`pk_users`). 테이블이 새 이름을 받았는데
        // 여기만 옛 이름이면 받는 설계 안에 같은 인덱스 이름이 둘 생긴다(PostgreSQL 은 스키마 단위).
        name: entry.finalName === t.name ? con.name : con.name.replaceAll(t.name, entry.finalName),
        columns: con.columns.map((r) => ({ ...r, columnId: colIds.get(r.columnId) ?? r.columnId }))
      }

      if (con.kind === 'fk') {
        const target = refTarget(t, con)
        if (target) {
          const hit = copiedBySourceKey.get(nameKey(target))
          // 옮겨 넣었으면 가리키는 칸도 옮긴다 — 안 그러면 출처 칸을 계속 가리켜 조용히 끊긴다.
          const moved = intoSchema !== undefined
          const destTarget: TableRef = { schema: destSchema(target), name: target.name }
          if (hit) {
            next.refTable = hit.finalName
            if (moved) next.refSchema = hit.schema
          } else if (existing.some((x) => sameTable(x, destTarget))) {
            if (moved) next.refSchema = destTarget.schema
            linkedFks.push({ table: entry.finalName, constraint: next.name, target: qualifiedName(destTarget) })
          } else if (resolveRef(source, t, con)) {
            // 출처에선 이어져 있었는데 그 대상을 안 가져왔다 — 우리가 끊은 참조라 빼고 넣는다.
            droppedFks.push({ table: entry.finalName, constraint: next.name, target: qualifiedName(target) })
            continue
          }
          // 남는 갈래: 출처에서도 이미 허공을 가리키던 FK — 원본 그대로 옮긴다.
        }
      }
      constraints.push(next)
    }

    tables.push({ ...t, id: tableId, designId, schema: entry.schema, name: entry.finalName, columns, constraints })
  }

  return { entries, droppedFks, linkedFks, tables }
}
