import type { Column, TableDef } from '../definition/types'
import type { SeedSet } from './types'

/**
 * 시드 세트 **선언** 판정(순수) — 자연키 기본값·완전성·등록 후보·상호 배타 토글.
 * 정본: `docs/spec/db-studio.md` Section `db-studio.seed.declaration` / `.set-list`.
 */

/**
 * 자동증가 표식 — 방언별 토큰을 모두 본다: MySQL/MariaDB `AUTO_INCREMENT`,
 * SQLite `AUTOINCREMENT`, PostgreSQL `IDENTITY` 및 `serial`/`bigserial` 타입.
 * (방언 인자를 받지 않는 이유: 역설계로 들여온 설계는 방언 토큰이 섞여 들어올 수 있어
 *  "이 설계의 방언이 아니면 무시"가 오히려 오판을 만든다.)
 */
const AUTO_INCREMENT = /auto_?increment|identity|\bserial\b/i

export function isAutoIncrement(col: Column): boolean {
  return AUTO_INCREMENT.test(col.defaultValue ?? '') || AUTO_INCREMENT.test(col.type)
}

/** PK 제약에 참여하는 컬럼명(제약이 선언한 순서). PK 가 없으면 빈 배열. */
export function pkColumnNames(t: TableDef): string[] {
  const pk = t.constraints.find((k) => k.kind === 'pk')
  if (!pk) return []
  return pk.columns
    .map((r) => t.columns.find((c) => c.id === r.columnId)?.name)
    .filter((n): n is string => !!n)
}

/**
 * 자연키 기본값 — PK 컬럼들. 단 **자동증가 PK 면 비운다**: 환경마다 값이 달라
 * 행 짝짓기 기준이 될 수 없으므로 사람이 업무 키(`code` 등)를 고르게 한다.
 */
export function defaultNaturalKey(t: TableDef): string[] {
  const pk = pkColumnNames(t)
  if (pk.length === 0) return []
  const byName = new Map(t.columns.map((c) => [c.name, c]))
  if (pk.some((n) => { const c = byName.get(n); return c ? isAutoIncrement(c) : false })) return []
  return pk
}

export type SeedSetStatus = 'ok' | 'no-natural-key'

/** 세트 완전성 — 자연키가 없으면 행 단위 비교·반영의 기준이 없다. */
export function seedSetStatus(s: Pick<SeedSet, 'naturalKey'>): SeedSetStatus {
  return s.naturalKey.length > 0 ? 'ok' : 'no-natural-key'
}

/** 세트를 새로 만들 수 있는 테이블 — 뷰(데이터를 담지 않음)와 이미 세트가 있는 테이블은 제외. 원래 순서 유지. */
export function seedSetCandidates(tables: TableDef[], sets: Pick<SeedSet, 'tableName'>[]): TableDef[] {
  const taken = new Set(sets.map((s) => s.tableName))
  return tables.filter((t) => !t.isView && !taken.has(t.name))
}

/** 테이블에서 세트 하나를 만든다(자연키는 기본값 규칙, 관리 강도는 안전한 쪽 `보장만`). */
export function createSeedSet(t: TableDef): SeedSet {
  return {
    designId: t.designId,
    tableName: t.name,
    naturalKey: defaultNaturalKey(t),
    ignoredColumns: [],
    strength: 'ensure',
    rows: []
  }
}

/** 자연키 컬럼 토글 — 켜면 무시 컬럼에서 빠진다(상호 배타). 켜는 순서가 키 구성 순서. */
export function toggleNaturalKeyColumn(s: SeedSet, column: string): SeedSet {
  const on = s.naturalKey.includes(column)
  return {
    ...s,
    naturalKey: on ? s.naturalKey.filter((c) => c !== column) : [...s.naturalKey, column],
    ignoredColumns: on ? s.ignoredColumns : s.ignoredColumns.filter((c) => c !== column)
  }
}

/** 무시 컬럼 토글 — 켜면 자연키에서 빠진다(상호 배타). */
export function toggleIgnoredColumn(s: SeedSet, column: string): SeedSet {
  const on = s.ignoredColumns.includes(column)
  return {
    ...s,
    ignoredColumns: on ? s.ignoredColumns.filter((c) => c !== column) : [...s.ignoredColumns, column],
    naturalKey: on ? s.naturalKey : s.naturalKey.filter((c) => c !== column)
  }
}
