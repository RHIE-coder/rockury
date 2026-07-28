import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { EnvironmentDef, EnvValue, RunRecord, RunStatus } from '../../shared/api/types'

/**
 * 운영부 저장소 — 환경과 실행 기록. `docs/spec/api-runner.md`.
 *
 * 여기서 지키는 것:
 *  · 환경 이름은 명세 안에서 유일 (같은 이름 둘이면 "어느 STG 냐"가 흐려진다)
 *  · **복제는 값을 안 가져온다** — 구조만 복사한다(STG 를 복제해 PROD 를 만들다 STG 키가 남는 사고)
 *  · 실행 기록이 붙은 환경은 **삭제 대신 보관** — 기록이 가리키는 환경이 사라지면 지나간 관측을
 *    해석할 수 없다
 *  · 실행 기록은 **불변** — 갱신 경로 자체를 두지 않는다
 */

// ── 환경 ──────────────────────────────────────────────────────────────────

interface EnvRow {
  id: string
  spec_id: string
  name: string
  base_url: string
  production: number
  values_json: string
}

const toEnv = (r: EnvRow): EnvironmentDef => ({
  id: r.id,
  specId: r.spec_id,
  name: r.name,
  baseUrl: r.base_url,
  production: r.production === 1,
  values: JSON.parse(r.values_json) as EnvValue[]
})

export function listEnvironments(specId: string): EnvironmentDef[] {
  return (
    getDb()
      .prepare(
        'SELECT id, spec_id, name, base_url, production, values_json FROM api_environments WHERE spec_id = ? ORDER BY position ASC'
      )
      .all(specId) as unknown as EnvRow[]
  ).map(toEnv)
}

export function getEnvironment(id: string): EnvironmentDef | undefined {
  const r = getDb()
    .prepare('SELECT id, spec_id, name, base_url, production, values_json FROM api_environments WHERE id = ?')
    .get(id) as unknown as EnvRow | undefined
  return r ? toEnv(r) : undefined
}

export interface SaveEnvironmentInput {
  id?: string
  specId: string
  name: string
  baseUrl: string
  production: boolean
  values: EnvValue[]
}

export function saveEnvironment(input: SaveEnvironmentInput): EnvironmentDef {
  const d = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('환경 이름이 비어 있습니다.')

  const seen = new Set<string>()
  for (const v of input.values) {
    if (!v.name.trim()) throw new Error('환경 값의 이름이 비어 있습니다.')
    if (seen.has(v.name)) throw new Error(`환경 값 '${v.name}' 이(가) 두 번 있습니다.`)
    seen.add(v.name)
  }

  const clash = d
    .prepare('SELECT id FROM api_environments WHERE spec_id = ? AND name = ? AND id != ?')
    .get(input.specId, name, input.id ?? '') as unknown as { id: string } | undefined
  if (clash) throw new Error(`환경 '${name}' 이(가) 이미 있습니다 — 이름은 명세 안에서 유일해야 합니다.`)

  const id = input.id ?? `env_${randomUUID().replace(/-/g, '').slice(0, 8)}`
  const values = JSON.stringify(input.values)
  const exists = d.prepare('SELECT id FROM api_environments WHERE id = ?').get(id)

  if (exists) {
    d.prepare(
      'UPDATE api_environments SET name = ?, base_url = ?, production = ?, values_json = ? WHERE id = ?'
    ).run(name, input.baseUrl.trim(), input.production ? 1 : 0, values, id)
  } else {
    const { c } = d
      .prepare('SELECT COUNT(*) AS c FROM api_environments WHERE spec_id = ?')
      .get(input.specId) as unknown as { c: number }
    d.prepare(
      'INSERT INTO api_environments (id, spec_id, name, base_url, production, values_json, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.specId, name, input.baseUrl.trim(), input.production ? 1 : 0, values, c)
  }
  return getEnvironment(id)!
}

/** 구조만 복사하고 **값은 비운다.** 비밀 표식은 유지 — 무엇이 비밀인지는 구조다. */
export function duplicateEnvironment(id: string, newName: string): EnvironmentDef {
  const src = getEnvironment(id)
  if (!src) throw new Error(`환경 "${id}" 가 없습니다.`)
  return saveEnvironment({
    specId: src.specId,
    name: newName,
    baseUrl: '',
    production: false,
    values: src.values.map((v) => ({ name: v.name, value: '', secret: v.secret }))
  })
}

export interface DeleteEnvironmentResult {
  deleted: boolean
  /** 실행 기록이 있어 삭제 대신 보관했다면 그 건수. */
  runCount: number
}

export function deleteEnvironment(id: string): DeleteEnvironmentResult {
  const d = getDb()
  const { c } = d
    .prepare('SELECT COUNT(*) AS c FROM api_runs WHERE environment_id = ?')
    .get(id) as unknown as { c: number }
  if (c > 0) return { deleted: false, runCount: c }
  d.prepare('DELETE FROM api_environments WHERE id = ?').run(id)
  return { deleted: true, runCount: 0 }
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  spec_id: string
  request_name: string
  environment_id: string
  environment_name: string
  base_version: string | null
  status: string
  http_status: number | null
  duration_ms: number
  created_at: string
  request_json: string
  response_json: string | null
  error: string | null
}

const toRun = (r: RunRow): RunRecord => ({
  id: r.id,
  specId: r.spec_id,
  requestName: r.request_name,
  environmentId: r.environment_id,
  environmentName: r.environment_name,
  baseVersion: r.base_version,
  status: r.status as RunStatus,
  httpStatus: r.http_status,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
  request: JSON.parse(r.request_json),
  response: r.response_json ? JSON.parse(r.response_json) : null,
  error: r.error
})

export type AppendRunInput = Omit<RunRecord, 'id' | 'createdAt'>

export function appendRun(input: AppendRunInput): RunRecord {
  const record: RunRecord = {
    ...input,
    id: `run_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    createdAt: new Date().toISOString()
  }
  getDb()
    .prepare(
      'INSERT INTO api_runs (id, spec_id, request_name, environment_id, environment_name, base_version, status, http_status, duration_ms, created_at, request_json, response_json, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      record.id,
      record.specId,
      record.requestName,
      record.environmentId,
      record.environmentName,
      record.baseVersion,
      record.status,
      record.httpStatus,
      record.durationMs,
      record.createdAt,
      JSON.stringify(record.request),
      record.response ? JSON.stringify(record.response) : null,
      record.error
    )
  return record
}

export interface ListRunsFilter {
  requestName?: string
  environmentId?: string
  status?: RunStatus
  limit?: number
}

export function listRuns(specId: string, filter: ListRunsFilter = {}): RunRecord[] {
  const where: string[] = ['spec_id = ?']
  const args: unknown[] = [specId]
  if (filter.requestName) {
    where.push('request_name = ?')
    args.push(filter.requestName)
  }
  if (filter.environmentId) {
    where.push('environment_id = ?')
    args.push(filter.environmentId)
  }
  if (filter.status) {
    where.push('status = ?')
    args.push(filter.status)
  }
  args.push(filter.limit ?? 200)
  return (
    getDb()
      .prepare(
        `SELECT * FROM api_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(...(args as never[])) as unknown as RunRow[]
  ).map(toRun)
}

export interface PruneResult {
  /** 상한을 넘겨 지운 건수. **조용히 사라지면 안 되므로** 세어서 돌려준다. */
  removed: number
}

/** 명세별 보관 상한. 넘치면 오래된 것부터 지우고 **몇 건 지웠는지 알린다**. */
export function pruneRuns(specId: string, keep: number): PruneResult {
  const d = getDb()
  const { c } = d
    .prepare('SELECT COUNT(*) AS c FROM api_runs WHERE spec_id = ?')
    .get(specId) as unknown as { c: number }
  if (c <= keep) return { removed: 0 }
  d.prepare(
    `DELETE FROM api_runs WHERE id IN (
       SELECT id FROM api_runs WHERE spec_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
     )`
  ).run(specId, keep)
  return { removed: c - keep }
}
