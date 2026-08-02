import { buildDelete, buildInsert, buildUpdate, pkColumns, type SqlDialect, type Statement } from '../../remote/data/sqlBuilder'
import type { TableDef } from '../definition/types'
import { seedPkValues } from './seedPk'
import { looksLikeSeedRef, parseSeedRef, seedRefCycles, unescapeSeedValue } from './seedRef'
import { naturalKeyLabel } from './seedRows'
import { seedApplyReadiness } from './seedSet'
import type { SeedRow, SeedSet } from './types'

/**
 * **설계 → 운영 반영 계획**(순수) — 정본 `docs/spec/db-design.md` Section `db-design.seed.apply-contract`.
 *
 * 실 DB 를 건드리지 않는다. 지금 실 DB 에 있는 행 목록을 입력으로 받아, 무엇을 넣고 고치고
 * 지울 후보로 볼지 **문장 목록**으로 계산한다. 실행(트랜잭션 게이트)은 이 계획을 그대로 태운다.
 *
 * 계약의 핵심(여기 코드가 그 문장들이다):
 *  - 매칭은 언제나 **짝짓기 기준으로 조회 → 실제 행**. PK 는 찾는 기준이 아니다.
 *  - PK 는 **INSERT 전용** — 이미 다른 값으로 존재하면 바꾸지 않고 불일치로 보고한다.
 *  - 시드가 PK 를 줄 때는 **그 PK 를 쓰는 다른 행이 있으면 중단**한다(남의 행을 덮어쓰는 유일한 경로).
 *  - 참조는 대상 행의 실제 PK 로 치환하고, 순서는 참조 그래프로 정렬한다.
 */

export type SeedApplyStepKind = 'insert' | 'update' | 'delete-candidate'

export interface SeedApplyStep {
  kind: SeedApplyStepKind
  table: string
  /** 사람이 읽는 행 이름(짝짓기 기준 값). */
  label: string
  statement: Statement
  /** update 일 때 바뀌는 컬럼. */
  changedColumns?: string[]
}

export type SeedApplyBlockerKind =
  | 'not-ready'
  | 'row-invalid'
  | 'missing-variable'
  | 'unresolved-ref'
  | 'pk-conflict'
  | 'cycle'
  | 'no-pk-value'

export interface SeedApplyBlocker {
  kind: SeedApplyBlockerKind
  table: string
  label?: string
  message: string
}

export interface SeedApplyPlan {
  /** 실행 순서대로. */
  steps: SeedApplyStep[]
  /** 하나라도 있으면 **반영하지 않는다**(반쯤 심고 마는 상태를 만들지 않는다). */
  blockers: SeedApplyBlocker[]
  summary: { inserts: number; updates: number; deleteCandidates: number; unchanged: number }
}

export interface SeedApplyInput {
  sets: SeedSet[]
  tables: TableDef[]
  dialect: SqlDialect
  /** 지금 실 DB 에 있는 행 — 테이블 이름 → 행 목록. */
  current: Record<string, Record<string, unknown>[]>
  /** 환경 변수 값 — `{{NAME}}` 치환용. */
  variables: Record<string, string>
}

const VAR = /^\s*\{\{\s*(\w+)\s*\}\}\s*$/

/** DB 값을 비교·바인드용 문자열로. NULL 은 null 로 남긴다(빈 문자열과 구별). */
const asText = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : String(v))

/** 참조 위상정렬 — 가리키는 쪽이 나중에 오도록 테이블 순서를 정한다. */
function orderTables(sets: SeedSet[]): string[] {
  const deps = new Map<string, Set<string>>()
  for (const s of sets) {
    const d = new Set<string>()
    for (const r of s.rows) {
      for (const v of Object.values(r.values)) {
        const t = parseSeedRef(v)
        if (t && t.table !== s.tableName) d.add(t.table)
      }
    }
    deps.set(s.tableName, d)
  }
  const out: string[] = []
  const done = new Set<string>()
  const visit = (name: string, path: Set<string>): void => {
    if (done.has(name) || path.has(name)) return
    path.add(name)
    for (const dep of deps.get(name) ?? []) if (deps.has(dep)) visit(dep, path)
    path.delete(name)
    if (!done.has(name)) {
      done.add(name)
      out.push(name)
    }
  }
  for (const name of deps.keys()) visit(name, new Set())
  return out
}

interface ResolveOutcome {
  values: Record<string, string | null>
  blockers: SeedApplyBlocker[]
}

/** 한 행의 셀 값들을 실제 값으로 푼다 — 변수 치환·참조 해석·리터럴 탈출 해제. */
function resolveRow(
  set: SeedSet,
  row: SeedRow,
  input: SeedApplyInput,
  pkOf: (tableName: string) => string[],
  matchIn: (tableName: string, keyValues: Record<string, string | null>) => Record<string, unknown> | undefined
): ResolveOutcome {
  const label = naturalKeyLabel(row, set.naturalKey) || row.id
  const blockers: SeedApplyBlocker[] = []
  const values: Record<string, string | null> = {}

  for (const [column, raw] of Object.entries(row.values)) {
    if (raw == null) {
      values[column] = null
      continue
    }

    const varName = VAR.exec(raw)?.[1]
    if (varName) {
      const v = input.variables[varName]
      if (v == null || v === '') {
        blockers.push({
          kind: 'missing-variable',
          table: set.tableName,
          label,
          message: `변수 ${varName} 의 값이 환경에 없어요 — 값을 채워야 반영할 수 있어요`
        })
        continue
      }
      values[column] = v
      continue
    }

    const ref = parseSeedRef(raw)
    if (ref) {
      const targetSet = input.sets.find((s) => s.tableName === ref.table)
      const targetRow = targetSet?.rows.find((r) => (r.alias ?? '').trim() === ref.alias)
      const targetPk = pkOf(ref.table)

      if (!targetSet || !targetRow) {
        blockers.push({
          kind: 'unresolved-ref',
          table: set.tableName,
          label,
          message: `참조 ${raw} 의 대상을 찾을 수 없어요`
        })
        continue
      }
      if (targetPk.length !== 1) {
        blockers.push({
          kind: 'unresolved-ref',
          table: set.tableName,
          label,
          message: `${ref.table} 의 PK 가 하나가 아니어서 참조로 가리킬 수 없어요(복합 PK)`
        })
        continue
      }

      // ① 대상 행이 이미 실 DB 에 있으면 그 행의 PK 값을 쓴다(환경마다 다른 그 값).
      const targetKeyValues: Record<string, string | null> = {}
      for (const c of targetSet.naturalKey) targetKeyValues[c] = asText(targetRow.values[c] ?? null)
      const existing = matchIn(ref.table, targetKeyValues)
      if (existing) {
        values[column] = asText(existing[targetPk[0]])
        continue
      }

      // ② 아직 없으면 — 대상 PK 를 시드가 정하는 경우에만 값을 미리 알 수 있다.
      const computed = seedPkValues(targetSet, targetRow, targetPk)[targetPk[0]]
      if (computed != null && computed !== '') {
        values[column] = computed
        continue
      }
      blockers.push({
        kind: 'unresolved-ref',
        table: set.tableName,
        label,
        message: `${ref.table} 의 ${ref.alias} 행이 아직 실 DB 에 없고 PK 를 DB 가 만들어 값을 미리 알 수 없어요 — ${ref.table} 의 PK 를 "시드가 정한다"로 바꾸거나 먼저 반영하세요`
      })
      continue
    }

    values[column] = looksLikeSeedRef(raw) ? raw : unescapeSeedValue(raw)
    if (looksLikeSeedRef(raw))
      blockers.push({
        kind: 'unresolved-ref',
        table: set.tableName,
        label,
        message: `참조 표기가 아니에요: ${raw}`
      })
  }
  return { values, blockers }
}

/** 두 값이 같은가 — 문자열로 비교(DB 는 숫자·불리언을 제각각 돌려준다). */
const sameValue = (a: string | null, b: unknown): boolean => {
  const bt = asText(b)
  if (a == null || bt == null) return a == null && bt == null
  return a === bt
}

export function planSeedApply(input: SeedApplyInput): SeedApplyPlan {
  const steps: SeedApplyStep[] = []
  const blockers: SeedApplyBlocker[] = []
  const summary = { inserts: 0, updates: 0, deleteCandidates: 0, unchanged: 0 }

  const tableByName = new Map(input.tables.map((t) => [t.name, t]))
  /**
   * 시드 문장은 **이름만** 쓴다 — 설계 테이블의 `schema` 를 붙이면 안 된다.
   * 그 값은 설계부 기본값(`public`, `db/schemaRef.DEFAULT_SCHEMA`)이라 대상 DB 에 같은 이름이
   * 있으리란 보장이 없다(MySQL 에 `public` 데이터베이스는 없다). 반영 대상 스키마를 고르는
   * 일은 아직 정해지지 않았다 — 정해지기 전까지 연결의 기본 스키마에 맡긴다.
   */
  const target = (name: string): { name: string } => ({ name })
  const pkOf = (name: string): string[] => {
    const t = tableByName.get(name)
    return t ? pkColumns(t) : []
  }

  // 순환은 저작 단계에서 막지만, 옛 설계·가져온 설계가 들고 있을 수 있어 여기서도 확인한다.
  for (const cycle of seedRefCycles(input.sets)) {
    blockers.push({
      kind: 'cycle',
      table: cycle[0]?.split('#')[0] ?? '',
      message: `참조가 순환해요(${cycle.join(' → ')}) — 어느 행을 먼저 넣을지 정할 수 없어요`
    })
  }

  /** 실 DB 행을 짝짓기 기준으로 찾는다. */
  const matchIn = (
    tableName: string,
    keyValues: Record<string, string | null>
  ): Record<string, unknown> | undefined => {
    const rows = input.current[tableName] ?? []
    const cols = Object.keys(keyValues)
    if (cols.length === 0) return undefined
    return rows.find((r) => cols.every((c) => sameValue(keyValues[c], r[c])))
  }

  const order = orderTables(input.sets)
  const ordered = [...input.sets].sort((a, b) => order.indexOf(a.tableName) - order.indexOf(b.tableName))

  for (const set of ordered) {
    const table = tableByName.get(set.tableName)
    const readiness = seedApplyReadiness(set, table)
    if (!readiness.ready) {
      blockers.push({
        kind: 'not-ready',
        table: set.tableName,
        message:
          readiness.reason === 'no-key'
            ? '짝짓기 기준이 없어 어느 행을 고쳐야 할지 알 수 없어요'
            : readiness.reason === 'volatile-key'
              ? `${(readiness.columns ?? []).join(', ')} 는 DB 가 값을 만드는 컬럼이라 짝짓기 기준이 될 수 없어요`
              : '테이블이 설계에 없어요'
      })
      continue
    }

    const pks = pkOf(set.tableName)
    const ignored = new Set(set.ignoredColumns)
    const seededKeys: Record<string, string | null>[] = []
    // 시드가 PK 를 정할 때, **시드 행끼리** 같은 PK 를 만드는지 본다. 실 DB 와의 충돌(아래 AC-4)만
    // 보면 이건 안 잡힌다 — 상수 규칙(`role-fixed`)이나 손으로 같은 값을 넣으면 전 행이 같은 PK 가
    // 되고, 계획은 조용히 통과했다가 반영 트랜잭션에서 두 번째 INSERT 가 터진다.
    const pkClaims = new Map<string, string>()

    for (const row of set.rows) {
      const label = naturalKeyLabel(row, set.naturalKey) || row.id
      const { values, blockers: rowBlockers } = resolveRow(set, row, input, pkOf, matchIn)
      if (rowBlockers.length) {
        blockers.push(...rowBlockers)
        continue
      }

      // 짝짓기 기준 값이 비면 매칭 근거가 없다 — 저작 단계 검증과 같은 판정을 반영에서도 막는다.
      const keyValues: Record<string, string | null> = {}
      let keyMissing = false
      for (const c of set.naturalKey) {
        const v = values[c] ?? null
        if (v == null || v.trim() === '') keyMissing = true
        keyValues[c] = v
      }
      if (keyMissing) {
        blockers.push({
          kind: 'row-invalid',
          table: set.tableName,
          label,
          message: '짝짓기 기준 값이 비어 있어 반영할 수 없어요'
        })
        continue
      }
      seededKeys.push(keyValues)

      const existing = matchIn(set.tableName, keyValues)

      // ── 이미 있는 행: 값만 맞춘다. PK 는 건드리지 않는다(계약 AC-3). ──
      if (existing) {
        const changes: Record<string, unknown> = {}
        for (const [column, v] of Object.entries(values)) {
          if (ignored.has(column)) continue
          if (pks.includes(column)) continue
          if (!(column in existing)) continue
          if (!sameValue(v, existing[column])) changes[column] = v
        }
        // 설계가 원하는 PK 와 실제가 다르면 바꾸지 않고 알린다(FK 를 흔드는 파괴적 작업).
        const wanted = seedPkValues(set, row, pks)
        for (const [pk, want] of Object.entries(wanted)) {
          if (pk in existing && !sameValue(want, existing[pk]))
            blockers.push({
              kind: 'pk-conflict',
              table: set.tableName,
              label,
              message: `설계가 원하는 ${pk}=${want} 와 실제 ${String(existing[pk])} 가 달라요 — PK 는 자동으로 바꾸지 않아요(FK 가 흔들립니다). 그대로 두거나 별도 마이그레이션으로 옮기세요`
            })
        }
        const changedColumns = Object.keys(changes)
        if (changedColumns.length === 0) {
          summary.unchanged++
          continue
        }
        steps.push({
          kind: 'update',
          table: set.tableName,
          label,
          changedColumns,
          statement: buildUpdate(input.dialect, target(set.tableName), set.naturalKey, keyValues, changes)
        })
        summary.updates++
        continue
      }

      // ── 없는 행: 넣는다. PK 는 여기서만 쓴다. ──
      const insertValues: Record<string, unknown> = {}
      for (const [column, v] of Object.entries(values)) {
        if (ignored.has(column)) continue
        if (pks.includes(column)) continue // PK 는 아래 전략 값으로만 넣는다
        insertValues[column] = v
      }
      const pkValues = seedPkValues(set, row, pks)
      for (const [pk, v] of Object.entries(pkValues)) insertValues[pk] = v

      // 시드 행끼리의 방어선 — 앞선 시드 행이 이미 이 PK 를 주장했으면 중단.
      let conflicted = false
      for (const [pk, v] of Object.entries(pkValues)) {
        const claimKey = `${pk} ${v}`
        const owner = pkClaims.get(claimKey)
        if (owner != null) {
          blockers.push({
            kind: 'pk-conflict',
            table: set.tableName,
            label,
            message: `${pk}=${v} 를 시드의 다른 행(${owner})도 만들어요 — 규칙이 행마다 달라지지 않으면 같은 PK 가 겹칩니다`
          })
          conflicted = true
        } else {
          pkClaims.set(claimKey, label)
        }
      }
      if (conflicted) continue

      // 실 DB 와의 방어선 — 그 PK 를 이미 다른 행이 쓰고 있으면 중단.
      for (const [pk, v] of Object.entries(pkValues)) {
        const holder = (input.current[set.tableName] ?? []).find((r) => sameValue(v, r[pk]))
        if (!holder) continue
        const holderKeyDiffers = set.naturalKey.some((c) => !sameValue(keyValues[c], holder[c]))
        if (holderKeyDiffers) {
          blockers.push({
            kind: 'pk-conflict',
            table: set.tableName,
            label,
            message: `${pk}=${v} 를 이미 다른 행이 쓰고 있어요 — 남의 행을 덮어쓸 수 있어 반영을 멈춰요`
          })
          conflicted = true
        }
      }
      if (conflicted) continue

      if ((set.pkStrategy ?? 'db') === 'seed' && pks.length > 0 && Object.keys(pkValues).length === 0) {
        blockers.push({
          kind: 'no-pk-value',
          table: set.tableName,
          label,
          message: 'PK 를 "시드가 정한다"로 뒀는데 값도 생성 규칙도 없어요'
        })
        continue
      }

      if (Object.keys(insertValues).length === 0) {
        blockers.push({
          kind: 'row-invalid',
          table: set.tableName,
          label,
          message: '넣을 값이 없어요'
        })
        continue
      }
      steps.push({
        kind: 'insert',
        table: set.tableName,
        label,
        statement: buildInsert(input.dialect, target(set.tableName), insertValues)
      })
      summary.inserts++
    }

    // ── 전권(삭제 후보): 실 DB 에만 있는 행. 실제 삭제는 사람이 확인해야 실행된다. ──
    if (set.strength === 'authoritative') {
      for (const dbRow of input.current[set.tableName] ?? []) {
        const inSeed = seededKeys.some((k) => set.naturalKey.every((c) => sameValue(k[c], dbRow[c])))
        if (inSeed) continue
        const keyValues: Record<string, unknown> = {}
        for (const c of set.naturalKey) keyValues[c] = dbRow[c]
        steps.push({
          kind: 'delete-candidate',
          table: set.tableName,
          label: set.naturalKey.map((c) => asText(dbRow[c]) ?? '∅').join(' · '),
          statement: buildDelete(input.dialect, target(set.tableName), set.naturalKey, keyValues)
        })
        summary.deleteCandidates++
      }
    }
  }

  return { steps, blockers, summary }
}
