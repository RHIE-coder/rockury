import { matchSeedRows, naturalKeyLabel, variableNameOf } from '../workspaces/seed/seedRows'
import { STRENGTH_GROUP_LABEL, STRENGTH_LABEL, type SeedRow, type SeedSet } from '../workspaces/seed/types'
import type { ChangeStatus, FieldChange } from './diff'

/**
 * 시드 diff — 두 버전 스냅샷의 **시드 델타**(세트 추가/삭제·선언 변경·행 추가/삭제/값 변경).
 *
 * 스키마 diff(`diff.ts`)와 **따로** 계산한다: 스키마 diff 는 실 DB 역설계 결과와도 비교되는데
 * (Migration Drift·Plan) 실 DB 에는 "시드 선언"이 없어, 한 함수로 묶으면 설계↔실DB 비교에서
 * 시드 전량이 "삭제"로 잡히는 거짓 델타가 나온다. 시드 비교는 설계 버전끼리에만 쓴다.
 */

export interface SeedRowDiff {
  /** 자연키 인코딩 값(내부 키). */
  key: string
  /** 사람이 읽는 행 이름(자연키 값). */
  label: string
  status: ChangeStatus
  changes: FieldChange[]
}

export interface SeedSetDiff {
  tableName: string
  status: ChangeStatus
  /** 선언(자연키·무시 컬럼·'설계에 없는 행' 처리) 변경. */
  declarationChanges: FieldChange[]
  rows: SeedRowDiff[]
  /** false = 자연키가 없거나 양쪽 자연키 선언이 달라 **행 단위 비교를 하지 않았다**. */
  comparable: boolean
}

export interface SeedDiffSummary {
  setsAdded: number
  setsRemoved: number
  setsModified: number
  rowsAdded: number
  rowsRemoved: number
  rowsModified: number
}

export interface SeedDiff {
  sets: SeedSetDiff[]
  summary: SeedDiffSummary
}

const listLabel = (v: string[]): string => (v.length ? v.join(', ') : '—')
const valLabel = (v: string | null): string => (v == null ? 'NULL' : v === '' ? '—' : v)

/** 변수 셀은 **이름으로** 비교한다 — `{{ X }}` 와 `{{X}}` 는 같은 변수(공백 차이가 diff 소음이 되지 않게). */
function normalizeCell(v: string | null): string | null {
  const name = variableNameOf(v)
  return name ? `{{${name}}}` : v
}

function rowChanges(base: SeedRow, target: SeedRow, ignored: Set<string>): FieldChange[] {
  const cols = [...new Set([...Object.keys(base.values), ...Object.keys(target.values)])]
  const out: FieldChange[] = []
  for (const c of cols) {
    if (ignored.has(c)) continue
    const b = normalizeCell(base.values[c] ?? null)
    const t = normalizeCell(target.values[c] ?? null)
    if (b !== t) out.push({ field: c, before: valLabel(b), after: valLabel(t) })
  }
  return out
}

function declarationChanges(base: SeedSet, target: SeedSet): FieldChange[] {
  const out: FieldChange[] = []
  if (base.naturalKey.join(',') !== target.naturalKey.join(','))
    out.push({ field: '짝짓기 기준', before: listLabel(base.naturalKey), after: listLabel(target.naturalKey) })
  if (base.ignoredColumns.join(',') !== target.ignoredColumns.join(','))
    out.push({ field: '무시 컬럼', before: listLabel(base.ignoredColumns), after: listLabel(target.ignoredColumns) })
  if (base.strength !== target.strength)
    out.push({ field: STRENGTH_GROUP_LABEL, before: STRENGTH_LABEL[base.strength], after: STRENGTH_LABEL[target.strength] })
  return out
}

/** 행 목록의 내용 지문 — 행 로컬 id 는 빼고 값만 본다(id 는 화면 편의값이라 정체성이 아니다). */
function rowsFingerprint(rows: SeedRow[]): string {
  return JSON.stringify(
    rows
      .map((r) =>
        Object.keys(r.values)
          .sort()
          .map((k) => [k, normalizeCell(r.values[k] ?? null)])
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  )
}

function emptySummary(): SeedDiffSummary {
  return { setsAdded: 0, setsRemoved: 0, setsModified: 0, rowsAdded: 0, rowsRemoved: 0, rowsModified: 0 }
}

/**
 * 두 스냅샷의 시드 목록을 비교한다. `undefined`(시드 개념이 없던 옛 스냅샷)는 빈 목록으로 읽는다.
 * 무시 컬럼은 **이후(target) 선언**을 기준으로 뺀다 — 방금 "무시"로 정한 컬럼이 과거 차이로
 * 계속 시끄럽게 남지 않도록.
 */
export function diffSeeds(base: SeedSet[] | undefined, target: SeedSet[] | undefined): SeedDiff {
  const summary = emptySummary()
  const sets: SeedSetDiff[] = []
  const baseSets = new Map((base ?? []).map((s) => [s.tableName, s]))
  const targetSets = new Map((target ?? []).map((s) => [s.tableName, s]))

  for (const [name, b] of baseSets) {
    if (targetSets.has(name)) continue
    sets.push({ tableName: name, status: 'removed', declarationChanges: [], rows: [], comparable: true })
    summary.setsRemoved++
    summary.rowsRemoved += b.rows.length
  }

  for (const [name, t] of targetSets) {
    const b = baseSets.get(name)
    if (!b) {
      sets.push({ tableName: name, status: 'added', declarationChanges: [], rows: [], comparable: true })
      summary.setsAdded++
      summary.rowsAdded += t.rows.length
      continue
    }

    const decl = declarationChanges(b, t)
    // 자연키가 없거나 양쪽 선언이 다르면 행 짝짓기 기준이 없다 — 선언 변경만 보고한다.
    const comparable = t.naturalKey.length > 0 && b.naturalKey.join(',') === t.naturalKey.join(',')
    const ignored = new Set(t.ignoredColumns)
    const rows: SeedRowDiff[] = []

    if (comparable) {
      for (const m of matchSeedRows(b.rows, t.rows, t.naturalKey)) {
        if (m.base && !m.target) {
          rows.push({ key: m.key, label: naturalKeyLabel(m.base, t.naturalKey), status: 'removed', changes: [] })
          summary.rowsRemoved++
        } else if (!m.base && m.target) {
          rows.push({ key: m.key, label: naturalKeyLabel(m.target, t.naturalKey), status: 'added', changes: [] })
          summary.rowsAdded++
        } else if (m.base && m.target) {
          const changes = rowChanges(m.base, m.target, ignored)
          if (changes.length) {
            rows.push({ key: m.key, label: naturalKeyLabel(m.target, t.naturalKey), status: 'modified', changes })
            summary.rowsModified++
          }
        }
      }
    }

    // 비교 불가(자연키 없음·선언 불일치)인데 행 내용이 실제로 다르면 **침묵하지 않는다** —
    // 근거 없이 추가/삭제로 부풀리지도 않되, "바뀌었는데 비교를 못 했다"는 사실은 보고한다.
    const rowsDiffer = !comparable && rowsFingerprint(b.rows) !== rowsFingerprint(t.rows)

    if (!decl.length && !rows.length && !rowsDiffer) continue
    sets.push({ tableName: name, status: 'modified', declarationChanges: decl, rows, comparable })
    summary.setsModified++
  }

  // 표시 순서: 추가 → 변경 → 삭제 (스키마 diff 와 같은 문법)
  const order: Record<ChangeStatus, number> = { added: 0, modified: 1, removed: 2 }
  sets.sort((a, b) => order[a.status] - order[b.status] || a.tableName.localeCompare(b.tableName))
  return { sets, summary }
}

export function isEmptySeedDiff(d: SeedDiff): boolean {
  return d.sets.length === 0
}
