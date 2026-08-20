import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  EnvironmentDef,
  EnvValue,
  InteractionShape,
  RunRecord,
  RunStatus,
  StreamMessage
} from '../../shared/api/types'

/**
 * 운영부 저장소 — 환경과 실행 기록.
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
  shape: string | null
  call_json: string | null
  status: string
  http_status: number | null
  duration_ms: number
  created_at: string
  request_json: string
  response_json: string | null
  message_count: number | null
  /** 목록 조회에서는 **안 읽는다**(undefined). 상세 조회에서만 채워진다. */
  messages_json?: string | null
  error: string | null
}

/**
 * 목록 조회가 읽는 칸. **`messages_json` 이 빠져 있다.**
 *
 * 세션 하나가 메시지 5,000건까지 들 수 있어서, 200건 목록을 읽으면 그걸 전부 SQLite 에서
 * 꺼내 `JSON.parse` 한다 — 실측 1.6초 동안 **메인 프로세스가 멈춘다**(메인은 다섯 서비스의
 * IPC 를 다 처리하므로 DB·Infra 화면까지 같이 선다). 목록 화면은 본문을 안 쓴다.
 */
const LIST_COLUMNS =
  'id, spec_id, request_name, environment_id, environment_name, base_version, shape, call_json, ' +
  'status, http_status, duration_ms, created_at, request_json, response_json, message_count, error'

const toRun = (r: RunRow): RunRecord => ({
  id: r.id,
  specId: r.spec_id,
  requestName: r.request_name,
  environmentId: r.environment_id,
  environmentName: r.environment_name,
  baseVersion: r.base_version,
  // 스트림 이전에 쌓인 기록은 전부 단발이다(칸이 생기기 전이라 null 일 수 있다).
  shape: (r.shape ?? 'unary') as InteractionShape,
  // 이 칸이 생기기 전에 쌓인 기록은 파라미터를 모른다 — 빈 묶음이 "안 넣었다"가 아니라
  // "기록에 없다" 는 뜻인데, 둘을 가르려면 칸을 하나 더 늘려야 해서 여기서는 합쳤다.
  call: JSON.parse(r.call_json ?? '{}') as Record<string, string>,
  status: r.status as RunStatus,
  httpStatus: r.http_status,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
  request: JSON.parse(r.request_json),
  response: r.response_json ? JSON.parse(r.response_json) : null,
  // 세 가지가 다른 뜻이다: `null` = 스트림이 아님 · `[]` = 세션은 열렸는데 0건 ·
  // 목록 조회에서는 아예 안 읽으므로 `messageCount` 로 몇 건인지만 알린다.
  messages:
    r.messages_json === undefined
      ? null
      : r.messages_json
        ? (JSON.parse(r.messages_json) as StreamMessage[])
        : null,
  messageCount: r.message_count,
  error: r.error
})

export type AppendRunInput = Omit<RunRecord, 'id' | 'createdAt' | 'messageCount'>

export function appendRun(input: AppendRunInput): RunRecord {
  const record: RunRecord = {
    ...input,
    id: `run_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    // 목록 화면이 본문 없이도 "몇 건이었나"를 말할 수 있게 세어 둔다.
    messageCount: input.messages ? input.messages.length : null
  }
  getDb()
    .prepare(
      'INSERT INTO api_runs (id, spec_id, request_name, environment_id, environment_name, base_version, shape, call_json, status, http_status, duration_ms, created_at, request_json, response_json, messages_json, message_count, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      record.id,
      record.specId,
      record.requestName,
      record.environmentId,
      record.environmentName,
      record.baseVersion,
      record.shape,
      JSON.stringify(record.call),
      record.status,
      record.httpStatus,
      record.durationMs,
      record.createdAt,
      JSON.stringify(record.request),
      record.response ? JSON.stringify(record.response) : null,
      record.messages ? JSON.stringify(record.messages) : null,
      record.messageCount,
      record.error
    )
  return record
}

/**
 * 기록 하나를 **본문까지** 읽는다. 목록에서 빠진 메시지를 여기서 꺼낸다 —
 * 예전엔 목록 1,000건을 읽어 `.find()` 로 골랐다(같은 자리에서 메시지도 전부 파싱했다).
 */
export function getRun(specId: string, runId: string): RunRecord | null {
  const r = getDb()
    .prepare(`SELECT ${LIST_COLUMNS}, messages_json FROM api_runs WHERE spec_id = ? AND id = ?`)
    .get(specId, runId) as unknown as RunRow | undefined
  return r ? toRun(r) : null
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
        `SELECT ${LIST_COLUMNS} FROM api_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(...(args as never[])) as unknown as RunRow[]
  ).map(toRun)
}

/**
 * 명세당 실행 기록 보관 상한. **여기가 유일한 자리다** — 단발 전송과 스트림 세션이 같은
 * 표를 자르므로, 숫자가 두 파일에 흩어지면 실효 보관량이 "마지막에 어느 경로가 돌았나"에
 * 따라 흔들린다.
 */
export const RUN_KEEP = 500

/**
 * 판정에 쓸 **세션 기록만** 본문까지 읽는다.
 *
 * 목록 조회는 메시지 본문을 안 싣는데(그러면 메인이 초 단위로 멈춘다) 스트림·수신 판정은
 * 그 본문이 있어야 돈다. 그래서 **요청마다 가장 최근 세션 하나씩만** 골라 읽는다 —
 * 단발 판정이 "가장 최근 성공 Run" 을 기준으로 삼는 것과 같은 규칙이라 규칙이 갈리지 않고,
 * 읽는 양이 요청 수만큼으로 묶인다.
 */
export function latestSessionRuns(specId: string, environmentId?: string): RunRecord[] {
  const where = ["spec_id = ?", "shape != 'unary'", "status = 'ok'"]
  const args: unknown[] = [specId]
  if (environmentId) {
    where.push('environment_id = ?')
    args.push(environmentId)
  }
  // 먼저 **본문 없이** 후보를 훑어 요청마다 최신 하나를 고른다.
  const heads = getDb()
    .prepare(
      `SELECT id, request_name FROM api_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC`
    )
    .all(...(args as never[])) as unknown as { id: string; request_name: string }[]

  const picked: string[] = []
  const seen = new Set<string>()
  for (const h of heads) {
    if (seen.has(h.request_name)) continue
    seen.add(h.request_name)
    picked.push(h.id)
  }
  return picked.map((id) => getRun(specId, id)).filter((r): r is RunRecord => r !== null)
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
