import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/**
 * Environment — 배포 바인딩(§IA · 결정 B). Connection 을 Design + 타깃/적용 버전에 묶는다.
 * Migration(Drift/Plan/Run) 전용 상태. (connection_id, design_id) 조합당 하나(자동 관리).
 * Console 은 Connection 만으로 동작하므로 여긴 관여하지 않는다.
 */
export interface EnvironmentRecord {
  id: string
  connectionId: string
  designId: string
  targetVersion: string
  appliedVersion: string | null
  createdAt: string
  updatedAt: string
}

interface EnvRow {
  id: string
  connection_id: string
  design_id: string
  target_version: string
  applied_version: string | null
  created_at: string
  updated_at: string
}

const toRecord = (r: EnvRow): EnvironmentRecord => ({
  id: r.id,
  connectionId: r.connection_id,
  designId: r.design_id,
  targetVersion: r.target_version,
  appliedVersion: r.applied_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function getEnvironment(id: string): EnvironmentRecord | null {
  const row = getDb().prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvRow | undefined
  return row ? toRecord(row) : null
}

export function findBinding(connectionId: string, designId: string): EnvironmentRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM environments WHERE connection_id = ? AND design_id = ?')
    .get(connectionId, designId) as EnvRow | undefined
  return row ? toRecord(row) : null
}

/** (connection, design) 바인딩을 찾거나 만든다. 마이그레이션 진입 시 호출. */
export function ensureBinding(
  connectionId: string,
  designId: string,
  targetVersion = ''
): EnvironmentRecord {
  const existing = findBinding(connectionId, designId)
  if (existing) {
    if (targetVersion && targetVersion !== existing.targetVersion) {
      return setTargetVersion(existing.id, targetVersion)
    }
    return existing
  }
  const d = getDb()
  const id = `env_${randomUUID()}`
  const now = new Date().toISOString()
  d.prepare(
    `INSERT INTO environments (id, connection_id, design_id, target_version, applied_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, connectionId, designId, targetVersion, now, now)
  return getEnvironment(id)!
}

export function setTargetVersion(id: string, version: string): EnvironmentRecord {
  getDb()
    .prepare('UPDATE environments SET target_version = ?, updated_at = ? WHERE id = ?')
    .run(version, new Date().toISOString(), id)
  return getEnvironment(id)!
}

export function setAppliedVersion(id: string, version: string): EnvironmentRecord {
  getDb()
    .prepare('UPDATE environments SET applied_version = ?, updated_at = ? WHERE id = ?')
    .run(version, new Date().toISOString(), id)
  return getEnvironment(id)!
}
