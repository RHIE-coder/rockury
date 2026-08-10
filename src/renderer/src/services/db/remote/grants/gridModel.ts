import type { EffectiveRow } from './effective'
import type { GrantsDiff } from './diff'
import { SET_PRIVILEGES, type GrantLayer, type PrivSource } from './types'

/**
 * 객체×권한 표의 파생 모형(§db-remote.grants.privileges·diff) — **순수 함수**.
 * 리뷰(H-5)의 뿌리가 이 로직이 뷰 안에 무테스트 인라인으로 있던 것이라, 여기로 빼서
 * '일치'의 뜻을 테스트로 못박는다: **매칭했고 변경이 없는 표**다. 대조 밖 표는 일치가 아니다.
 */

const CORE = [...SET_PRIVILEGES] as string[]
const key = (db: string, table: string): string => `${db} ${table}`

export type LayerFilter = 'ALL' | GrantLayer
export type DiffFilter = 'ALL' | 'match' | 'missing' | 'excess'

export interface GridRow extends EffectiveRow {
  /** 대조 모드 전용 — 이 표의 (권한 → 표식). */
  marks?: Record<string, 'missing' | 'excess'>
  /** 대조 모드 전용 — 표 단위 지위. */
  status?: 'match' | 'changed' | 'outside'
}

export interface GridModel {
  rows: GridRow[]
  /** 층 필터 칩 개수(권한 출처 기준). */
  layerCounts: Record<LayerFilter, number>
  /** 대조 칩 개수 — **행(표) 단위**: 칩의 숫자가 곧 그 필터의 행 수다(숫자가 초대한 기대와
   *  클릭 결과가 어긋나면 대조 보고를 못 믿는다 — 재채점 M-1). null 이면 층 모드. */
  diffCounts: { ALL: number; match: number; missing: number; excess: number } | null
  /**
   * 전역 층에서만 온 "그 외" 권한 — 모든 행이 같은 정보라 행마다 반복하지 않고
   * 표 위 요약 한 줄로 뺀다(리뷰 H-9: 관리자 계정의 배지 벽). "그대로 다 보인다"(vendor
   * AC-5)와 "같은 정보는 한 화면에 한 번"의 양립.
   */
  globalExtras: string[]
}

export function buildGridModel(
  effective: EffectiveRow[],
  diff: GrantsDiff | null,
  layerFilter: LayerFilter,
  diffFilter: DiffFilter
): GridModel {
  // 전역-전용 그 외 권한(요약 대상)과, 행에 남길 그 외(전역 아닌 출처가 하나라도 있는 것)를 가른다.
  const globalExtras = new Set<string>()
  for (const r of effective)
    for (const [priv, sources] of Object.entries(r.privs)) {
      if (CORE.includes(priv)) continue
      if (sources.every((s) => s.layer === 'global')) globalExtras.add(priv)
    }

  const stripGlobalExtras = (r: EffectiveRow): EffectiveRow => {
    const privs: Record<string, PrivSource[]> = {}
    for (const [priv, sources] of Object.entries(r.privs)) {
      if (!CORE.includes(priv) && sources.every((s) => s.layer === 'global')) continue
      privs[priv] = sources
    }
    return { ...r, privs }
  }

  // 층 필터 칩 개수 — 요약으로 뺀 전역 그 외는 안 센다(행에 없는 것을 세면 칩이 거짓말한다).
  const layerCounts: Record<LayerFilter, number> = { ALL: 0, global: 0, database: 0, table: 0, column: 0 }
  const stripped = effective.map(stripGlobalExtras).filter((r) => Object.keys(r.privs).length > 0)
  for (const r of stripped)
    for (const sources of Object.values(r.privs))
      for (const s of sources) {
        layerCounts.ALL += 1
        layerCounts[s.layer] += 1
      }

  if (!diff) {
    const rows = stripped.filter(
      (r) =>
        layerFilter === 'ALL' ||
        Object.values(r.privs).some((ss) => ss.some((s) => s.layer === layerFilter))
    )
    return { rows, layerCounts, diffCounts: null, globalExtras: [...globalExtras].sort() }
  }

  // ── 대조 모드 ──────────────────────────────────────────────────────────────
  const matched = new Set(diff.matchedKeys)
  const marksByTable = new Map<string, Record<string, 'missing' | 'excess'>>()
  for (const c of diff.changes) {
    const k = key(c.db, c.table)
    const m = marksByTable.get(k) ?? {}
    m[c.privilege] = c.kind
    marksByTable.set(k, m)
  }

  // 모자람만 있는 표(유효 권한 0)는 effective 에 없다 — 행을 만들어 필터를 **같이** 태운다.
  const present = new Set(stripped.map((r) => key(r.db, r.table)))
  const missingOnly: GridRow[] = [...marksByTable.keys()]
    .filter((k) => !present.has(k))
    .map((k) => {
      const sp = k.indexOf(' ')
      return { db: k.slice(0, sp), table: k.slice(sp + 1), privs: {} }
    })

  const withStatus: GridRow[] = [...stripped, ...missingOnly].map((r) => {
    const k = key(r.db, r.table)
    const marks = marksByTable.get(k)
    const status: GridRow['status'] = !matched.has(k) ? 'outside' : marks ? 'changed' : 'match'
    return { ...r, ...(marks ? { marks } : {}), status }
  })

  const rows = withStatus
    .filter((r) => {
      if (diffFilter === 'ALL') return true
      if (diffFilter === 'match') return r.status === 'match' // 대조 밖은 일치가 아니다(AC-7)
      return Object.values(r.marks ?? {}).includes(diffFilter)
    })
    .sort((a, b) => a.db.localeCompare(b.db) || a.table.localeCompare(b.table))

  const diffCounts = {
    ALL: withStatus.length,
    match: withStatus.filter((r) => r.status === 'match').length,
    missing: withStatus.filter((r) => Object.values(r.marks ?? {}).includes('missing')).length,
    excess: withStatus.filter((r) => Object.values(r.marks ?? {}).includes('excess')).length
  }

  return { rows, layerCounts, diffCounts, globalExtras: [...globalExtras].sort() }
}
