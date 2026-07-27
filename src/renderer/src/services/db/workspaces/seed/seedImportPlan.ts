import { pkColumns } from '../../console/data/sqlBuilder'
import type { TableDef } from '../definition/types'
import { formatSeedRef } from './seedRef'
import { defaultAlias } from './seedRef'
import { naturalKeyLabel } from './seedRows'
import { isDbGenerated, seedApplyReadiness } from './seedSet'
import type { SeedSet } from './types'

/**
 * **운영 → 설계 되먹임 계획**(순수) — 정본 `db-studio.seed.apply-contract` AC-6.
 *
 * 실 DB 에서 읽은 행을 설계에 들일 **후보**로 만든다. 자동으로 넣지 않는다 — 운영 DB 에는
 * 설계로 올려선 안 되는 행(임시 계정·환경 전용)이 섞이고, 그 판단은 사람만 할 수 있다.
 *
 * 되돌리기 규칙:
 *  - 짝짓기 기준으로 행을 짝짓는다.
 *  - **DB 가 만드는 PK 는 설계에 담지 않는다**(환경마다 달라 diff 소음이 된다).
 *  - FK 컬럼 값은 **참조 표기로 되돌린다**(`7` → `@users#admin`) — 반영 때 쓰는 규칙과 같은 함수.
 *  - 무시 컬럼은 애초에 비교·수집 대상이 아니다.
 */

export type SeedImportStatus = 'new' | 'changed' | 'only-in-design'

export interface SeedImportChange {
  column: string
  design: string | null
  actual: string | null
}

export interface SeedImportCandidate {
  table: string
  status: SeedImportStatus
  /** 사람이 읽는 행 이름(짝짓기 기준 값). */
  label: string
  /** 채택하면 설계에 들어갈 값(참조 되돌리기·PK 제외가 이미 적용된 상태). */
  values: Record<string, string | null>
  /** `changed` 일 때 무엇이 어떻게 다른지. */
  changes?: SeedImportChange[]
  /** `changed`·`only-in-design` 일 때 대응하는 설계 행 id. */
  rowId?: string
  /** `new` 일 때 제안하는 별칭. */
  suggestedAlias?: string
}

export interface SeedImportPlan {
  candidates: SeedImportCandidate[]
  /** 되돌리지 못한 것 등 사람이 알아야 할 사실(침묵하지 않는다). */
  notes: string[]
  summary: { added: number; changed: number; onlyInDesign: number }
}

export interface SeedImportInput {
  sets: SeedSet[]
  tables: TableDef[]
  /** 실 DB 에서 읽은 행 — 테이블 이름 → 행 목록. */
  current: Record<string, Record<string, unknown>[]>
}

const asText = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : String(v))
const sameValue = (a: unknown, b: unknown): boolean => {
  const at = asText(a)
  const bt = asText(b)
  return at == null || bt == null ? at == null && bt == null : at === bt
}

/** 테이블의 FK 컬럼 → 가리키는 테이블(단일 대상만 되돌린다). */
function fkTargetOf(table: TableDef): Map<string, string> {
  const out = new Map<string, string>()
  for (const con of table.constraints) {
    if (con.kind !== 'fk' || !con.refTable) continue
    for (const ref of con.columns) {
      const name = table.columns.find((c) => c.id === ref.columnId)?.name
      if (name && !out.has(name)) out.set(name, con.refTable)
    }
  }
  return out
}

export function planSeedImport(input: SeedImportInput): SeedImportPlan {
  const candidates: SeedImportCandidate[] = []
  const notes: string[] = []
  const summary = { added: 0, changed: 0, onlyInDesign: 0 }

  const tableByName = new Map(input.tables.map((t) => [t.name, t]))
  const setByTable = new Map(input.sets.map((s) => [s.tableName, s]))

  /** FK 값 → 참조 표기. 되돌릴 근거가 없으면 null(원값을 그대로 두고 알린다). */
  const toRef = (refTable: string, value: unknown): string | null => {
    const targetTable = tableByName.get(refTable)
    const targetSet = setByTable.get(refTable)
    if (!targetTable || !targetSet) return null
    const targetPk = pkColumns(targetTable)
    if (targetPk.length !== 1) return null

    const dbRow = (input.current[refTable] ?? []).find((r) => sameValue(r[targetPk[0]], value))
    if (!dbRow) return null
    // 그 DB 행의 짝짓기 기준 값으로 설계 행을 찾아 별칭을 얻는다.
    const seedRow = targetSet.rows.find((r) =>
      targetSet.naturalKey.every((c) => sameValue(r.values[c] ?? null, dbRow[c]))
    )
    const alias = (seedRow?.alias ?? '').trim()
    return alias ? formatSeedRef(refTable, alias) : null
  }

  for (const set of input.sets) {
    const table = tableByName.get(set.tableName)
    if (!seedApplyReadiness(set, table).ready || !table) {
      notes.push(`${set.tableName}: 짝짓기 기준이 준비되지 않아 가져오지 않았어요`)
      continue
    }

    const ignored = new Set(set.ignoredColumns)
    const pks = pkColumns(table)
    const byName = new Map(table.columns.map((c) => [c.name, c]))
    const fkTargets = fkTargetOf(table)
    const dbRows = input.current[set.tableName] ?? []

    /** 이 DB 행에서 설계로 들일 값들 — PK·무시 컬럼 제외 + FK 는 참조로 되돌림. */
    const collect = (dbRow: Record<string, unknown>): Record<string, string | null> => {
      const out: Record<string, string | null> = {}
      for (const c of table.columns) {
        if (ignored.has(c.name)) continue
        // DB 가 만드는 PK 는 담지 않는다(환경마다 다른 값 — 설계 정본에 넣지 않는다는 원칙).
        if (pks.includes(c.name) && ((set.pkStrategy ?? 'db') === 'db' || isDbGenerated(c))) continue
        if (!(c.name in dbRow)) continue

        const refTable = fkTargets.get(c.name)
        const raw = dbRow[c.name]
        if (refTable && raw != null) {
          const ref = toRef(refTable, raw)
          if (ref) {
            out[c.name] = ref
            continue
          }
          notes.push(
            `${set.tableName}.${c.name}: ${String(raw)} 를 참조 표기로 되돌리지 못했어요(대상 시드 행·별칭 없음) — 원값을 그대로 뒀어요`
          )
        }
        out[c.name] = asText(raw)
      }
      return out
    }

    const matchedSeedRows = new Set<string>()

    for (const dbRow of dbRows) {
      const seedRow = set.rows.find((r) =>
        set.naturalKey.every((c) => sameValue(r.values[c] ?? null, dbRow[c]))
      )
      const label = set.naturalKey.map((c) => asText(dbRow[c]) ?? '∅').join(' · ')
      const values = collect(dbRow)

      if (!seedRow) {
        candidates.push({
          table: set.tableName,
          status: 'new',
          label,
          values,
          suggestedAlias: defaultAlias(set.naturalKey.map((c) => asText(dbRow[c])))
        })
        summary.added++
        continue
      }

      matchedSeedRows.add(seedRow.id)
      const changes: SeedImportChange[] = []
      for (const [column, actual] of Object.entries(values)) {
        if (set.naturalKey.includes(column)) continue // 기준 값이 같아서 짝지어진 행이다
        const design = seedRow.values[column] ?? null
        if (!sameValue(design, actual)) changes.push({ column, design, actual })
      }
      if (changes.length === 0) continue

      candidates.push({ table: set.tableName, status: 'changed', label, values, changes, rowId: seedRow.id })
      summary.changed++
    }

    for (const r of set.rows) {
      if (matchedSeedRows.has(r.id)) continue
      candidates.push({
        table: set.tableName,
        status: 'only-in-design',
        label: naturalKeyLabel(r, set.naturalKey) || r.id,
        values: {},
        rowId: r.id
      })
      summary.onlyInDesign++
    }

    // 컬럼이 설계에만 있고 실 DB 에 없으면(스키마 드리프트) 알린다 — 조용히 넘기면 오해한다.
    for (const c of table.columns) {
      if (ignored.has(c.name) || dbRows.length === 0) continue
      if (!(c.name in dbRows[0]) && byName.has(c.name))
        notes.push(`${set.tableName}.${c.name}: 실 DB 조회 결과에 이 컬럼이 없어요(스키마가 다를 수 있어요)`)
    }
  }

  return { candidates, notes, summary }
}
