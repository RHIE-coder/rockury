import { createHash, randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 운영부 Migration 저장소(§ops-plan Phase 3a/3e).
 *  - env_snapshots: 환경별 post-apply/baseline 스냅샷(드리프트 기준선). checksum 으로 1차 비교.
 *  - migration_logs: 드리프트+반영 로그 체인 = 환경 변경 이력.
 */

export interface SnapshotRecord {
  id: string
  envId: string
  version: string
  snapshot: unknown
  checksum: string
  createdAt: string
}

export interface CreateSnapshotInput {
  envId: string
  version: string
  snapshot: unknown
}

interface SnapshotRow {
  id: string
  env_id: string
  version: string
  snapshot: string
  checksum: string
  created_at: string
}

const toSnapshot = (r: SnapshotRow): SnapshotRecord => ({
  id: r.id,
  envId: r.env_id,
  version: r.version,
  snapshot: JSON.parse(r.snapshot),
  checksum: r.checksum,
  createdAt: r.created_at
})

export function saveSnapshot(input: CreateSnapshotInput): SnapshotRecord {
  const json = JSON.stringify(input.snapshot)
  const checksum = createHash('sha256').update(json).digest('hex')
  const rec: SnapshotRecord = {
    id: `snap_${randomUUID()}`,
    envId: input.envId,
    version: input.version,
    snapshot: input.snapshot,
    checksum,
    createdAt: new Date().toISOString()
  }
  getDb()
    .prepare(
      'INSERT INTO env_snapshots (id, env_id, version, snapshot, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(rec.id, rec.envId, rec.version, json, checksum, rec.createdAt)
  return rec
}

/** 환경의 최신 스냅샷(드리프트 기준선). 없으면 null. */
export function latestSnapshot(envId: string): SnapshotRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM env_snapshots WHERE env_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(envId) as SnapshotRow | undefined
  return row ? toSnapshot(row) : null
}

/** 시드 반영은 스키마 반영(apply)과 성격이 달라 종류를 가른다 — 이력에서 구분해 읽어야 한다. */
export type MigrationLogKind = 'baseline' | 'drift' | 'apply' | 'seed-apply'

export interface MigrationLogRecord {
  id: string
  envId: string
  kind: MigrationLogKind
  fromVersion: string
  toVersion: string
  summary: string
  status: 'success' | 'error'
  detail: string
  createdAt: string
}

export interface CreateLogInput {
  envId: string
  kind: MigrationLogKind
  fromVersion?: string
  toVersion?: string
  summary?: string
  status?: 'success' | 'error'
  detail?: string
}

interface LogRow {
  id: string
  env_id: string
  kind: string
  from_version: string
  to_version: string
  summary: string
  status: string
  detail: string
  created_at: string
}

const toLog = (r: LogRow): MigrationLogRecord => ({
  id: r.id,
  envId: r.env_id,
  kind: r.kind as MigrationLogKind,
  fromVersion: r.from_version,
  toVersion: r.to_version,
  summary: r.summary,
  status: r.status as 'success' | 'error',
  detail: r.detail,
  createdAt: r.created_at
})

export function appendLog(input: CreateLogInput): MigrationLogRecord {
  const rec: MigrationLogRecord = {
    id: `mlog_${randomUUID()}`,
    envId: input.envId,
    kind: input.kind,
    fromVersion: input.fromVersion ?? '',
    toVersion: input.toVersion ?? '',
    summary: input.summary ?? '',
    status: input.status ?? 'success',
    detail: input.detail ?? '',
    createdAt: new Date().toISOString()
  }
  getDb()
    .prepare(
      'INSERT INTO migration_logs (id, env_id, kind, from_version, to_version, summary, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      rec.id,
      rec.envId,
      rec.kind,
      rec.fromVersion,
      rec.toVersion,
      rec.summary,
      rec.status,
      rec.detail,
      rec.createdAt
    )
  return rec
}

export function listLogs(envId: string): MigrationLogRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM migration_logs WHERE env_id = ? ORDER BY created_at DESC')
    .all(envId) as unknown as LogRow[]
  return rows.map(toLog)
}
