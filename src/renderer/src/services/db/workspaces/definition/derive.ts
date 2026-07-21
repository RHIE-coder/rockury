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
