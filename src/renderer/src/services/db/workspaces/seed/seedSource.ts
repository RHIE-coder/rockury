import type { TableDef } from '../definition/types'
import { canBeMatchKey, createSeedSet, defaultNaturalKey, seedApplyReadiness, type SeedApplyBlock } from './seedSet'
import type { SeedSet } from './types'

/**
 * **되먹임의 재료 고르기**(순수) — 실 DB 에서 행을 읽어 올 테이블을 고르는 목록.
 *
 * 왜 필요한가: 되먹임(운영 → 설계)은 **이미 시드 세트가 있는 테이블**만 대상이었다. 그래서
 * 운영 DB 를 방금 가져온 설계(세트 0개)에서는 화면이 통째로 막혀, 운영에 이미 있는 admin
 * 계정·Role 을 사람이 Design › Seed 에서 손으로 다시 쳐 넣어야 했다
 * (2026-08-18 사용자: "테이블 안에 있는 일부 데이터를 가져올 수는 없는거야? Seed Data 로
 * 셋팅하게 … 서비스가 운영되기위해 필요한 Init Data").
 *
 * 여기서는 **고를 수 있는 것과 그 이유**만 계산한다. 읽기·저장은 부르는 쪽이 한다.
 */

/**
 * 짝짓기 기준 짐작 — PK 가 먼저, 안 되면 **UNIQUE 키**.
 *
 * 왜 UK 까지 보나: 운영 DB 에서 가져온 테이블은 대개 PK 가 자동증가·`DEFAULT (UUID())` 라
 * 환경마다 값이 달라 기준이 못 된다(`defaultNaturalKey` 가 그래서 비운다). 그런데 사람이
 * 시드로 삼고 싶어 하는 표(계정·역할·설정)는 바로 그런 모양이고, 대신 `email`·`code`·`key`
 * 같은 UNIQUE 를 갖고 있다 — 그게 사람이 "같은 행"이라고 부르는 기준이다.
 * 짧은 것을 고른다: 컬럼이 적을수록 사람이 읽는 행 이름이 또렷하다.
 */
export function guessNaturalKey(t: TableDef): string[] {
  const pk = defaultNaturalKey(t)
  if (pk.length > 0) return pk

  const byId = new Map(t.columns.map((c) => [c.id, c]))
  const usable = t.constraints
    .filter((k) => k.kind === 'uk')
    .map((k) => k.columns.map((r) => byId.get(r.columnId)).filter((c): c is NonNullable<typeof c> => !!c))
    .filter((cols) => cols.length > 0 && cols.every(canBeMatchKey))
    .map((cols) => cols.map((c) => c.name))
  if (usable.length === 0) return []
  return usable.reduce((best, cur) => (cur.length < best.length ? cur : best))
}

/** 이 테이블로 만들 시드 세트 — 짝짓기 기준만 짐작으로 채운 빈 세트. */
export const seedSetFor = (t: TableDef): SeedSet => ({ ...createSeedSet(t), naturalKey: guessNaturalKey(t) })

/**
 * 시드가 못 다루는 까닭 — 짝짓기 기준 문제(`SeedApplyBlock`)에 **이름 문제** 둘을 더한다.
 *
 * 시드 세트는 테이블을 **이름으로만** 가리킨다(`SeedSet.tableName`). 반영도 이름만 써서
 * 연결의 기본 DB 에 나간다(`seedApplyPlan` 의 `target` 주석 — 대상 스키마를 고르는 일은
 * 아직 정해지지 않았다). 그래서 스키마 여럿을 걸친 설계에서는 이름이 겹치거나 기본 DB 밖에
 * 있는 표가 생기고, 그건 시드로 다룰 수 없다. **막고 이유를 말한다** — 체크는 되는데 엉뚱한
 * 표를 읽는 것이 제일 나쁘다(2026-08-18 사용자: 같은 이름 둘이 함께 켜졌다).
 */
export type SeedSourceBlock = SeedApplyBlock | 'outside-default-schema' | 'ambiguous-name'

export interface SeedSourceOption {
  tableName: string
  /** 이 이름을 대표하는 테이블의 스키마(있을 때) — 화면이 어느 표인지 밝히는 데 쓴다. */
  schema?: string
  /** 이미 시드 세트가 있는 테이블 — 고르면 기존 세트에 되먹인다(새로 만들지 않는다). */
  hasSet: boolean
  /** 짝짓기 기준 — 세트가 있으면 그 세트의 것, 없으면 설계에서 추정한 것. */
  naturalKey: string[]
  /** 행을 읽어 들일 수 있는가. */
  ready: boolean
  reason?: SeedSourceBlock
}

/**
 * 이름 하나를 대표하는 테이블 — 기본 DB 안의 것이 있으면 그것, 없으면 첫째.
 * 시드가 이름으로만 가리키므로 **이름당 한 줄**이어야 한다(둘을 그리면 체크가 함께 켜진다).
 */
function groupByName(tables: TableDef[]): Map<string, TableDef[]> {
  const byName = new Map<string, TableDef[]>()
  for (const t of tables) {
    if (t.isView) continue
    const list = byName.get(t.name)
    if (list) list.push(t)
    else byName.set(t.name, [t])
  }
  return byName
}

/** 기본 DB 안에 있는 것들 — 스키마를 모르는 설계(옛 데이터)는 다 안에 있는 것으로 본다. */
const insideDefault = (group: TableDef[], defaultSchema?: string): TableDef[] =>
  defaultSchema ? group.filter((t) => !t.schema || t.schema === defaultSchema) : group

/**
 * 고를 수 있는 테이블 — 설계 순서 그대로, **이름당 한 줄**. 뷰는 뺀다(데이터를 담지 않는다).
 * 못 고르는 것도 **목록에 남긴다**: 조용히 빼면 "왜 내 테이블이 없지?"가 된다.
 *
 * @param defaultSchema 이 연결의 기본 DB. 모르면(빈 값) 스키마로 거르지 않는다.
 */
export function seedSourceOptions(
  tables: TableDef[],
  sets: SeedSet[],
  defaultSchema?: string
): SeedSourceOption[] {
  const bySet = new Map(sets.map((s) => [s.tableName, s]))
  const out: SeedSourceOption[] = []

  for (const [name, group] of groupByName(tables)) {
    const inside = insideDefault(group, defaultSchema)
    const rep = inside[0] ?? group[0]
    const set = bySet.get(name)
    const naturalKey = set ? set.naturalKey : guessNaturalKey(rep)

    let reason: SeedSourceBlock | undefined
    if (inside.length === 0) reason = 'outside-default-schema'
    else if (inside.length > 1) reason = 'ambiguous-name'
    else reason = seedApplyReadiness({ tableName: name, naturalKey }, rep).reason

    out.push({ tableName: name, schema: rep.schema, hasSet: !!set, naturalKey, ready: !reason, reason })
  }
  return out
}

/** 고른 이름이 실제로 가리키는 테이블 — 이름당 하나(대표). */
export function seedSourceTable(
  tables: TableDef[],
  name: string,
  defaultSchema?: string
): TableDef | undefined {
  const group = groupByName(tables).get(name)
  if (!group) return undefined
  return insideDefault(group, defaultSchema)[0] ?? group[0]
}

export const SOURCE_BLOCK_LABEL: Record<SeedSourceBlock, string> = {
  'missing-table': '설계에 없는 테이블',
  'no-key': '짝짓기 기준 없음 — PK·UK 가 필요해요',
  'volatile-key': '짝짓기 기준이 환경마다 달라져요',
  'outside-default-schema': '이 연결의 기본 DB 밖 — 시드는 아직 기본 DB 만 다뤄요',
  'ambiguous-name': '같은 이름이 여러 스키마에 있어 어느 표인지 가릴 수 없어요'
}

/** 처음 켜 둘 것 — 이미 세트가 있어 예전부터 되먹임 대상이던 테이블. 없으면 아무것도 안 고른다. */
export const defaultSeedSources = (options: SeedSourceOption[]): string[] =>
  options.filter((o) => o.hasSet && o.ready).map((o) => o.tableName)

/**
 * 고른 테이블로 되먹임에 쓸 세트를 만든다 — 있는 것은 그대로, 없는 것은 **빈 세트**로.
 * 빈 세트를 물리면 실 DB 의 모든 행이 "설계에 없음" 후보로 올라온다(그게 이 화면의 목적이다).
 * 설계에 없는 테이블 이름은 떨어뜨린다 — 읽을 대상이 없다.
 */
export function seedSourceSets(input: {
  tables: TableDef[]
  sets: SeedSet[]
  picked: string[]
  defaultSchema?: string
}): SeedSet[] {
  const picked = new Set(input.picked)
  const bySet = new Map(input.sets.map((s) => [s.tableName, s]))
  const out: SeedSet[] = []
  // 이름당 하나 — 같은 이름이 스키마마다 있으면 세트가 두 벌 생겨 서로를 덮는다.
  for (const [name, group] of groupByName(input.tables)) {
    if (!picked.has(name)) continue
    const rep = insideDefault(group, input.defaultSchema)[0] ?? group[0]
    out.push(bySet.get(name) ?? seedSetFor(rep))
  }
  return out
}

/**
 * 담기 전에 새로 만들어야 할 세트 — 고른 것 중 아직 없는 것.
 * 읽을 때 물렸던 것과 **같은 짝짓기 기준**이어야 한다: 다르면 방금 담은 행이 다음 되먹임에서
 * 짝을 못 찾아 "설계에 없음"으로 또 올라온다.
 */
export function seedSetsToCreate(input: {
  tables: TableDef[]
  sets: SeedSet[]
  tableNames: string[]
  defaultSchema?: string
}): SeedSet[] {
  const want = new Set(input.tableNames)
  const have = new Set(input.sets.map((s) => s.tableName))
  const out: SeedSet[] = []
  for (const [name, group] of groupByName(input.tables)) {
    if (!want.has(name) || have.has(name)) continue
    out.push(seedSetFor(insideDefault(group, input.defaultSchema)[0] ?? group[0]))
  }
  return out
}
