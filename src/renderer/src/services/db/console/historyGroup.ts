import type { HistoryRow } from './query/store'

/**
 * History 표시 단위 — 컬렉션 한 번 실행(runId 로 묶인 여러 문)은 **그룹**(아코디언),
 * 그 밖(단일 Query/Data 실행)은 **단일 행**. 순수 함수 → 테스트 의무.
 *
 * 입력 rows 는 최신순(created_at DESC). 그룹은 그 안의 최신 행 위치에 놓여 순서가 보존되고,
 * 그룹 내부 행은 컬렉션 순번(seq) 오름차순으로 정렬한다(#1, #2, …).
 */
export interface HistoryGroup {
  kind: 'group'
  runId: string
  source: string
  collectionName: string | null
  createdAt: string
  rows: HistoryRow[]
  /** 그룹 전체 영향/조회 행 합계(표시용). */
  totalRows: number
  /** 모든 문이 성공이면 true. */
  ok: boolean
}
export interface HistorySingle {
  kind: 'single'
  row: HistoryRow
}
export type HistoryEntry = HistoryGroup | HistorySingle

const rowsOf = (r: HistoryRow): number => (r.affectedRows != null ? r.affectedRows : r.rowCount)

export function groupHistory(rows: HistoryRow[]): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const groupByRun = new Map<string, HistoryGroup>()
  for (const r of rows) {
    if (r.runId) {
      let g = groupByRun.get(r.runId)
      if (!g) {
        // 최신순 입력이므로 그룹의 첫 등장 위치 = 그 그룹의 최신 시각 위치.
        g = { kind: 'group', runId: r.runId, source: r.source, collectionName: r.collectionName, createdAt: r.createdAt, rows: [], totalRows: 0, ok: true }
        groupByRun.set(r.runId, g)
        entries.push(g)
      }
      g.rows.push(r)
    } else {
      entries.push({ kind: 'single', row: r })
    }
  }
  // 그룹 내부 정렬(seq 오름차순) + 합계/상태 집계.
  for (const g of groupByRun.values()) {
    g.rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    g.totalRows = g.rows.reduce((s, r) => s + rowsOf(r), 0)
    g.ok = g.rows.every((r) => r.status === 'success')
    g.collectionName = g.rows.find((r) => r.collectionName)?.collectionName ?? g.collectionName
  }
  return entries
}
