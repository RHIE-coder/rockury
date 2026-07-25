import { getDb } from './db'

/**
 * Version — Design 의 불변(immutable) 스냅샷(IA). `v0.3.13` 처럼 식별, 설계별 단조 증가.
 * snapshot 은 컷 시점의 스키마 전체(테이블·컬럼·제약)를 담은 JSON.
 */
export interface VersionRecord {
  id: string
  designId: string
  number: string
  note: string
  snapshot: unknown
  locked: boolean
  createdAt: string
}

export interface CreateVersionInput {
  designId: string
  number: string
  note?: string
  snapshot: unknown
}

interface VersionRow {
  id: string
  design_id: string
  number: string
  note: string
  snapshot: string
  locked: number
  created_at: string
}

const toRecord = (r: VersionRow): VersionRecord => ({
  id: r.id,
  designId: r.design_id,
  number: r.number,
  note: r.note,
  snapshot: JSON.parse(r.snapshot),
  locked: r.locked === 1,
  createdAt: r.created_at
})

// created_at 은 ms 해상도라 연속 컷이 같은 값이 될 수 있다 — rowid(삽입 순) DESC 를 tiebreak 로
// 두어 "가장 최근 컷"이 결정적으로 정해지게 한다(latestVersion·자동 patch 기준의 비결정성 제거).
const VERSION_ORDER = 'ORDER BY created_at DESC, rowid DESC'

export function listVersions(designId: string): VersionRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, design_id, number, note, snapshot, locked, created_at FROM versions WHERE design_id = ? ${VERSION_ORDER}`
    )
    .all(designId) as unknown as VersionRow[]
  return rows.map(toRecord)
}

/** 버전 삭제 — 잘못 컷된 버전 회수용. 스냅샷 JSON 이 버전 행에 담겨 있어 행 삭제로 완결. */
export function deleteVersion(id: string): void {
  getDb().prepare('DELETE FROM versions WHERE id = ?').run(id)
}

export function createVersion(input: CreateVersionInput): VersionRecord {
  const d = getDb()
  const record: VersionRecord = {
    id: `${input.designId}@${input.number}`,
    designId: input.designId,
    number: input.number,
    note: (input.note ?? '').trim(),
    snapshot: input.snapshot,
    locked: false,
    createdAt: new Date().toISOString()
  }
  d.prepare(
    'INSERT INTO versions (id, design_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(
    record.id,
    record.designId,
    record.number,
    record.note,
    JSON.stringify(record.snapshot),
    record.createdAt
  )
  return record
}
