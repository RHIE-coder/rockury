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
  /** 찍을 때 읽은 스키마 범위. 빈 배열 = 예전 스냅샷(범위를 안 남기던 시절) 또는 "기본 하나". */
  scope: string[]
  createdAt: string
}

export interface CreateSnapshotInput {
  envId: string
  version: string
  snapshot: unknown
  scope?: string[]
}

interface SnapshotRow {
  id: string
  env_id: string
  version: string
  snapshot: string
  checksum: string
  scope: string | null
  created_at: string
}

/** scope 는 예전 행에서 NULL 일 수 있고, 깨진 JSON 이어도 조회 전체를 죽이면 안 된다. */
function parseScope(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

const toSnapshot = (r: SnapshotRow): SnapshotRecord => ({
  id: r.id,
  envId: r.env_id,
  version: r.version,
  snapshot: JSON.parse(r.snapshot),
  checksum: r.checksum,
  scope: parseScope(r.scope),
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
    scope: input.scope ?? [],
    createdAt: new Date().toISOString()
  }
  getDb()
    .prepare(
      'INSERT INTO env_snapshots (id, env_id, version, snapshot, checksum, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(rec.id, rec.envId, rec.version, json, checksum, JSON.stringify(rec.scope), rec.createdAt)
  return rec
}

/**
 * 환경의 최신 스냅샷(드리프트 기준선). 없으면 null.
 *
 * rowid 로 동률을 깬다 — created_at 은 밀리초라 연속 저장이면 같은 값이 나올 수 있고,
 * 그러면 이 함수와 listSnapshots 의 첫 줄이 서로 다른 것을 가리켜 화면이 어긋난다.
 */
export function latestSnapshot(envId: string): SnapshotRecord | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM env_snapshots WHERE env_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    )
    .get(envId) as SnapshotRow | undefined
  return row ? toSnapshot(row) : null
}

/** 목록용 요약 — 본문(snapshot)은 뺀다. */
export interface SnapshotSummary {
  id: string
  envId: string
  version: string
  tableCount: number
  checksum: string
  scope: string[]
  createdAt: string
}

interface SummaryRow {
  id: string
  env_id: string
  version: string
  checksum: string
  scope: string | null
  created_at: string
  table_count: number | null
}

/**
 * 환경의 기준선 이력(최신 순).
 *
 * 본문 대신 테이블 수만 SQL 에서 뽑는다 — 스냅샷 하나가 수십 KB 라 목록에 통째로 실으면
 * IPC 가 무거워지는데, 화면은 "언제 · 무엇이 찍혔나"만 필요하다.
 * `$.tables` 가 없는 예전 형태의 스냅샷은 json_array_length 가 NULL 을 주므로 0 으로 떨어뜨린다.
 */
export function listSnapshots(envId: string): SnapshotSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, env_id, version, checksum, scope, created_at,
              json_array_length(snapshot, '$.tables') AS table_count
         FROM env_snapshots WHERE env_id = ? ORDER BY created_at DESC, rowid DESC`
    )
    .all(envId) as unknown as SummaryRow[]
  return rows.map((r) => ({
    id: r.id,
    envId: r.env_id,
    version: r.version,
    tableCount: r.table_count ?? 0,
    checksum: r.checksum,
    scope: parseScope(r.scope),
    createdAt: r.created_at
  }))
}

/**
 * 이력에서 구분해 읽어야 하는 사건들.
 *  - `map` — 이 연결이 어느 버전인지 못박은 순간(맵핑). 흐름의 시작점이라 따로 남긴다.
 *  - `drift` — 기준선을 덮기 **전에** 무엇이 달랐는지. 덮고 나면 되짚을 길이 없어서 적는다.
 *  - `seed-apply` — 시드 반영은 스키마 반영(apply)과 대상도 게이트도 달라 갈라 둔다.
 */
export type MigrationLogKind = 'map' | 'baseline' | 'drift' | 'apply' | 'seed-apply'

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
