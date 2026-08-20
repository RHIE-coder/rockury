import type { Column, TableDef } from '../definition/types'
import type { SeedSet } from './types'

/**
 * 시드 세트 **선언** 판정(순수) — 자연키 기본값·완전성·등록 후보·상호 배타 토글.
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

/**
 * **DB 가 값을 만드는 컬럼** — 자동증가 또는 기본값이 DB 함수(`uuid()`·`gen_random_uuid()`·
 * `now()` 등). 이런 값은 환경마다 달라지므로 **짝짓기 기준이 될 수 없다**(어느 행이 같은 행인지
 * 판단할 근거가 못 된다). 시드가 값을 직접 주는 컬럼은 여기 해당하지 않는다.
 */
const DB_GENERATED_DEFAULT = /\b(uuid|uuid_generate_v\d|gen_random_uuid|newid|sys_guid|now|current_timestamp|localtimestamp|sysdate|random|nextval)\s*\(?/i

export function isDbGenerated(col: Column): boolean {
  if (isAutoIncrement(col)) return true
  const d = col.defaultValue ?? ''
  return d.trim() !== '' && DB_GENERATED_DEFAULT.test(d)
}

/** 짝짓기 기준으로 고를 수 있는 컬럼인가 — DB 가 만드는 값은 환경 간 안정적이지 않아 못 고른다. */
export function canBeMatchKey(col: Column): boolean {
  return !isDbGenerated(col)
}

/** 왜 못 고르는지 — 화면이 그 자리에서 설명해야 사용자가 헤매지 않는다. */
export function matchKeyBlockedReason(col: Column): string | null {
  if (canBeMatchKey(col)) return null
  return isAutoIncrement(col)
    ? '자동증가 컬럼은 환경마다 값이 달라 짝짓기 기준이 될 수 없어요'
    : 'DB 가 값을 만드는 컬럼(기본값이 함수)은 환경마다 값이 달라 짝짓기 기준이 될 수 없어요'
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
 * 짝짓기 기준 기본값 — PK 컬럼들. 단 **DB 가 값을 만드는 PK 면 비운다**: 자동증가뿐 아니라
 * `DEFAULT (UUID())`·`gen_random_uuid()` 처럼 DB 가 채우는 값도 환경마다 달라 기준이 될 수 없다.
 * (회귀: 자동증가만 걸렀더니 `CHAR(36) DEFAULT (UUID())` PK 가 기본 기준으로 들어가 반영이 막혔다.)
 */
export function defaultNaturalKey(t: TableDef): string[] {
  const pk = pkColumnNames(t)
  if (pk.length === 0) return []
  const byName = new Map(t.columns.map((c) => [c.name, c]))
  if (
    pk.some((n) => {
      const c = byName.get(n)
      return c ? !canBeMatchKey(c) : false
    })
  )
    return []
  return pk
}

export interface NaturalKeyBacking {
  /** 자연키와 **정확히 같은 컬럼 구성**의 PK/UK 가 설계에 있는가. */
  backed: boolean
  /** 뒷받침하는 제약의 종류·이름(있을 때). */
  by?: { kind: 'pk' | 'uk'; name: string }
}

/**
 * 자연키를 실 DB 의 UNIQUE 가 뒷받침하는가 — 반영 단계(UPSERT)의 성립 조건 판정.
 *
 * 왜 **정확히 같은 구성**만 인정하나: UPSERT 는 충돌 대상 컬럼을 그대로 지목한다
 * (`ON CONFLICT (a, b)` / `INSERT … ON DUPLICATE KEY`). 자연키가 (a,b) 인데 UNIQUE 가 (a) 뿐이면
 * DB 는 다른 기준으로 충돌을 판정하고, (a,b) 중 (a) 만 있는 경우도 유일성이 보장되지 않는다.
 * 순서는 무시한다 — 제약의 컬럼 순서는 유일성에 영향을 주지 않는다.
 */
export function naturalKeyBacking(table: TableDef, naturalKey: string[]): NaturalKeyBacking {
  if (naturalKey.length === 0) return { backed: false }
  const nameOf = new Map(table.columns.map((c) => [c.id, c.name]))
  const want = [...naturalKey].sort().join('\u0000')

  for (const con of table.constraints) {
    if (con.kind !== 'pk' && con.kind !== 'uk') continue
    const cols = con.columns
      .map((r) => nameOf.get(r.columnId))
      .filter((n): n is string => !!n)
      .sort()
      .join('\u0000')
    if (cols === want) return { backed: true, by: { kind: con.kind, name: con.name } }
  }
  return { backed: false }
}

export type SeedApplyBlock = 'missing-table' | 'no-key' | 'volatile-key'

export interface SeedApplyReadiness {
  /** 실 DB 반영((b) 단계)의 전제를 갖췄는가. */
  ready: boolean
  reason?: SeedApplyBlock
  /** 문제가 된 컬럼들(volatile-key 일 때). */
  columns?: string[]
}

/**
 * 반영 준비 판정 — 짝짓기 기준에 **환경 간 안정적인 컬럼이 1개 이상** 있어야 반영이 성립한다.
 * 저작·비교는 그대로 되지만 이 판정이 아니면 (b) 반영 대상에서 빠진다.
 * (옛 설계·역설계로 들여온 세트가 DB 생성 컬럼을 기준으로 갖고 있을 수 있어 화면 제한과 별도로 판정한다.)
 */
export function seedApplyReadiness(
  s: Pick<SeedSet, 'naturalKey' | 'tableName'>,
  table: TableDef | undefined
): SeedApplyReadiness {
  if (!table) return { ready: false, reason: 'missing-table' }
  if (s.naturalKey.length === 0) return { ready: false, reason: 'no-key' }
  const byName = new Map(table.columns.map((c) => [c.name, c]))
  const volatile = s.naturalKey.filter((n) => {
    const col = byName.get(n)
    return col ? !canBeMatchKey(col) : false
  })
  if (volatile.length) return { ready: false, reason: 'volatile-key', columns: volatile }
  return { ready: true }
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

/** 테이블에서 세트 하나를 만든다(자연키는 기본값 규칙, 설계에 없는 행은 안전한 쪽 `그대로 둠`). */
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

/**
 * 컬럼이 시드에서 맡는 역할 — 세 가지 중 **정확히 하나**다.
 *  - `key`     : 짝짓기 기준(= 자연키). 어느 행이 어느 행인지 알아보는 기준.
 *  - `include` : 값을 맞출 대상(기본).
 *  - `ignore`  : 환경마다 달라도 차이로 보지 않음.
 * naturalKey·ignoredColumns 가 이미 상호 배타라 세 상태는 겹치지 않는다.
 */
export type SeedColumnRole = 'key' | 'include' | 'ignore'

export const SEED_ROLE_LABEL: Record<SeedColumnRole, string> = {
  key: '짝짓기',
  include: '포함',
  ignore: '무시'
}

export const SEED_ROLE_HINT: Record<SeedColumnRole, string> = {
  key: '짝짓기 기준 — 어느 행이 이미 있는 행인지 알아보는 기준이에요. 눌러서 포함으로.',
  include: '값을 맞출 대상 — 설계와 다르면 차이로 봅니다. 눌러서 무시로.',
  ignore: '비교에서 뺌 — 환경마다 달라도 차이로 안 봅니다. 눌러서 짝짓기 기준으로.'
}

export function seedColumnRole(s: Pick<SeedSet, 'naturalKey' | 'ignoredColumns'>, column: string): SeedColumnRole {
  if (s.naturalKey.includes(column)) return 'key'
  if (s.ignoredColumns.includes(column)) return 'ignore'
  return 'include'
}

/**
 * 그리드에 **그릴** 컬럼 — `무시` 컬럼을 감출 수 있다.
 *
 * 왜 여기(순수 함수)인가: 이건 **보기 설정**일 뿐 세트 선언(`ignoredColumns`)을 건드리지 않는다.
 * 감춘 컬럼도 비교·반영에서는 그대로 무시 대상이다 — 화면에서만 빠진다.
 */
export function visibleSeedColumns<T extends { name: string }>(
  s: Pick<SeedSet, 'naturalKey' | 'ignoredColumns'>,
  columns: T[],
  hideIgnored: boolean
): T[] {
  if (!hideIgnored) return columns
  return columns.filter((c) => seedColumnRole(s, c.name) !== 'ignore')
}

/**
 * 역할 순환 — `짝짓기 → 포함 → 무시 → 짝짓기`. 버튼 하나로 세 상태를 돈다.
 * (예전엔 KEY·무시 두 버튼이었는데 둘이 이미 배타여서 실은 한 축이었다.)
 */
/**
 * 역할 한 칸 돌리기. `allowKey=false`(DB 가 값을 만드는 컬럼)면 `짝짓기` 를 건너뛰어
 * `포함 → 무시 → 포함` 으로만 돈다 — 고를 수 없는 상태를 눌러서 만들 수 없게 한다.
 */
export function cycleSeedColumnRole(s: SeedSet, column: string, allowKey = true): SeedSet {
  const cur = seedColumnRole(s, column)
  const next: Record<SeedColumnRole, SeedColumnRole> = allowKey
    ? { key: 'include', include: 'ignore', ignore: 'key' }
    : { key: 'include', include: 'ignore', ignore: 'include' }
  return setSeedColumnRole(s, column, next[cur])
}

/** 역할을 직접 지정. 짝짓기 기준은 **켜는 순서가 곧 키 구성 순서**라 뒤에 붙인다. */
export function setSeedColumnRole(s: SeedSet, column: string, role: SeedColumnRole): SeedSet {
  const naturalKey = s.naturalKey.filter((c) => c !== column)
  const ignoredColumns = s.ignoredColumns.filter((c) => c !== column)
  if (role === 'key') naturalKey.push(column)
  if (role === 'ignore') ignoredColumns.push(column)
  return { ...s, naturalKey, ignoredColumns }
}
