import type { Constraint, ConstraintKind, KeyType, TableDef } from './types'

export interface KeyBadge {
  kind: KeyType
  /** 복합 제약(컬럼 2개 이상)에서의 1-based 위치. 단일 컬럼이면 undefined. */
  pos?: number
}

const KIND_TO_KEY: Partial<Record<ConstraintKind, KeyType>> = {
  pk: 'pk',
  fk: 'fk',
  uk: 'uk',
  idx: 'idx'
}
const KEY_ORDER: KeyType[] = ['pk', 'fk', 'uk', 'idx']

/**
 * 컬럼별 키 배지를 constraints 에서 파생한다 — Column 에 keys 를 따로 두지 않는 단일 소스.
 * 같은 종류가 여러 제약에 걸리면 첫 번째 것만 표시(pos 포함).
 */
export function keyBadgesOf(table: TableDef): Map<string, KeyBadge[]> {
  const map = new Map<string, KeyBadge[]>()
  for (const con of table.constraints) {
    const key = KIND_TO_KEY[con.kind]
    if (!key) continue
    con.columns.forEach((ref, i) => {
      const badges = map.get(ref.columnId) ?? []
      if (badges.some((b) => b.kind === key)) return
      badges.push({ kind: key, pos: con.columns.length > 1 ? i + 1 : undefined })
      map.set(ref.columnId, badges)
    })
  }
  for (const badges of map.values()) {
    badges.sort((a, b) => KEY_ORDER.indexOf(a.kind) - KEY_ORDER.indexOf(b.kind))
  }
  return map
}

/** PK 제약에 걸린 컬럼 id 집합 — 표시(NULL 칸 잠금)와 아래 `enforcePkNotNull` 이 함께 쓴다. */
export function pkColumnIds(table: TableDef): Set<string> {
  const ids = new Set<string>()
  for (const con of table.constraints) {
    if (con.kind !== 'pk') continue
    for (const ref of con.columns) ids.add(ref.columnId)
  }
  return ids
}

/**
 * PK 컬럼의 `nullable` 을 끈 사본 — **편집과 불러오기가 함께 지나는 문**이다.
 *
 * PK 는 SQL 표준에서 곧 NOT NULL 이라 실 DB 에는 언제나 NOT NULL 로 만들어진다. 설계만 NULL 을
 * 들고 있으면 두 가지가 동시에 터진다: 화면이 "PK 인데 NULL 가능"이라는 있을 수 없는 모습을
 * 보이고(2026-08-12 사용자: "PK인데 null이 가능해?"), 대조표에는 아무리 반영해도 안 사라지는
 * 가짜 차이가 한 줄 남는다. 그래서 화면에서 못 누르게 막는 것으로 끝내지 않고 데이터를 바로잡는다.
 *
 * 바꿀 것이 없으면 **같은 객체를 돌려준다** — 스토어가 참조 비교로 "바뀐 설계"를 가리므로
 * (`changedDesignIds`), 새 객체를 만들면 아무 편집도 없이 저장이 돈다.
 */
export function enforcePkNotNull(table: TableDef): TableDef {
  const pk = pkColumnIds(table)
  if (pk.size === 0) return table
  if (!table.columns.some((c) => pk.has(c.id) && c.nullable)) return table
  return {
    ...table,
    columns: table.columns.map((c) => (pk.has(c.id) && c.nullable ? { ...c, nullable: false } : c))
  }
}

/** 제약 columns 를 실제 컬럼 이름으로 해석(삭제된 컬럼은 걸러짐). */
export function resolveColumns(
  table: TableDef,
  con: Constraint
): { columnId: string; name: string; direction?: 'ASC' | 'DESC' }[] {
  return con.columns.flatMap((ref) => {
    const col = table.columns.find((c) => c.id === ref.columnId)
    return col ? [{ columnId: ref.columnId, name: col.name, direction: ref.direction }] : []
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * CHECK 식이 참조하는 (테이블에 실재하는) 컬럼들 — 표시 전용 파생값.
 *
 * CHECK 는 임의의 불리언 식이라 식 자체가 진실의 원천이고 컬럼 목록은 강제하지 않는다.
 * 대신 식별자 토큰을 컬럼명과 매칭해, 이 CHECK 가 어떤 컬럼을 건드리는지 보여준다.
 * 식별자 경계([A-Za-z0-9_])로 부분 일치를 배제(예: `total` 이 `total_amount` 에 안 걸림).
 */
export function checkColumns(
  table: TableDef,
  con: Constraint
): { columnId: string; name: string }[] {
  if (con.kind !== 'check' || !con.expression) return []
  const expr = con.expression
  return table.columns.flatMap((c) => {
    if (!c.name) return []
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(c.name)}(?![A-Za-z0-9_])`, 'i')
    return re.test(expr) ? [{ columnId: c.id, name: c.name }] : []
  })
}

/** 어느 CHECK 라도 참조하는 컬럼 id 집합 — 컬럼 행의 CHK 마커용. */
export function checkColumnIds(table: TableDef): Set<string> {
  const ids = new Set<string>()
  for (const con of table.constraints) {
    if (con.kind !== 'check') continue
    for (const c of checkColumns(table, con)) ids.add(c.columnId)
  }
  return ids
}
