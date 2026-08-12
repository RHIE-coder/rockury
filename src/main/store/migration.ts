import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * 운영부 Migration 저장소 — `migration_logs`(맵핑·반영 이력) 하나뿐이다.
 *
 * 예전엔 `env_snapshots`(기준선)도 여기 있었다. 기준선은 "마지막으로 확인한 실 DB 모습"을
 * 남겨 두고 지금과 견줘 남이 손댔는지 가리는 장치였는데, 2026-08-12 에 걷어냈다 — 남이 만든
 * 것은 "설계에 없는데 DB 에 있는 것"으로 이미 드러나고, 기준선이 홀로 감당하던 일은
 * "알고도 그냥 두기"를 기록하는 것뿐이라 값이 안 나왔다.
 */

/**
 * 이력에서 구분해 읽어야 하는 사건들.
 *  - `map` — 이 연결이 어느 버전인지 못박은 순간(맵핑). 흐름의 시작점이라 따로 남긴다.
 *  - `seed-apply` — 시드 반영은 스키마 반영(apply)과 대상도 게이트도 달라 갈라 둔다.
 */
export type MigrationLogKind = 'map' | 'apply' | 'seed-apply'

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
