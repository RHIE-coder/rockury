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

export function listVersions(designId: string): VersionRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT id, design_id, number, note, snapshot, locked, created_at FROM versions WHERE design_id = ? ORDER BY created_at DESC'
    )
    .all(designId) as unknown as VersionRow[]
  return rows.map(toRecord)
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
