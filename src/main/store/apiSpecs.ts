import { getDb } from './db'
import { INTERFACE_KINDS, interfaceMeta, type InterfaceKind, type RequestDef, type SpecDef } from '../../shared/api/types'
import { validateParamDefs } from '../../shared/api/signature'

/**
 * API 명세 저장소 — `docs/spec/api-service.md` §2.
 *
 * **명세의 데이터 규칙은 여기 한 곳에서 강제한다.** 화면·IPC·MCP 세 진입 경로가 있는데
 * 규칙이 화면에 있으면 나머지 둘이 그냥 우회한다(steward build 규율).
 * 여기서 지키는 것: 인터페이스 종류 유효성 · 종류↔모양 정합 · 요청 이름 유일성 ·
 * 파라미터 정의 정합 · 인터페이스가 안 쓰는 칸 거부.
 */

export interface SpecSummary {
  id: string
  name: string
  description: string
  kind: InterfaceKind
  requestCount: number
  latestVersion: string | null
  createdAt: string
}

export interface CreateSpecInput {
  name: string
  kind: string
  description?: string
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spec'
  )
}

export function requireKind(value: unknown): InterfaceKind {
  const v = String(value ?? '').trim().toLowerCase()
  if ((INTERFACE_KINDS as readonly string[]).includes(v)) return v as InterfaceKind
  throw new Error(
    `인터페이스 종류 '${String(value)}' 를 모릅니다 — 허용: ${INTERFACE_KINDS.join(', ')}`
  )
}

// ── 명세 ──────────────────────────────────────────────────────────────────

export function listSpecs(): SpecSummary[] {
  const d = getDb()
  const rows = d
    .prepare('SELECT id, name, description, kind, created_at FROM api_specs ORDER BY created_at ASC')
    .all() as unknown as { id: string; name: string; description: string; kind: string; created_at: string }[]

  return rows.map((r) => {
    const { c } = d.prepare('SELECT COUNT(*) AS c FROM api_requests WHERE spec_id = ?').get(r.id) as unknown as {
      c: number
    }
    const v = d
      .prepare('SELECT number FROM api_versions WHERE spec_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(r.id) as unknown as { number: string } | undefined
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind as InterfaceKind,
      requestCount: c,
      latestVersion: v?.number ?? null,
      createdAt: r.created_at
    }
  })
}

export function getSpec(id: string): SpecDef | undefined {
  const d = getDb()
  const row = d
    .prepare('SELECT id, name, description, kind FROM api_specs WHERE id = ?')
    .get(id) as unknown as { id: string; name: string; description: string; kind: string } | undefined
  if (!row) return undefined
  return { ...row, kind: row.kind as InterfaceKind, requests: listRequests(id) }
}

export function createSpec(input: CreateSpecInput): SpecSummary {
  const d = getDb()
  const kind = requireKind(input.kind)
  const name = input.name.trim()
  if (!name) throw new Error('명세 이름이 비어 있습니다.')

  const base = slugify(name)
  const taken = new Set(listSpecs().map((s) => s.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  const createdAt = new Date().toISOString()
  d.prepare('INSERT INTO api_specs (id, name, description, kind, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    (input.description ?? '').trim(),
    kind,
    createdAt
  )
  return { id, name, description: (input.description ?? '').trim(), kind, requestCount: 0, latestVersion: null, createdAt }
}

/** 이름·설명만 고친다 — 인터페이스 종류는 고정 속성이라 입력 표면에 없다(spec §2). */
export function updateSpec(id: string, patch: { name: string; description: string }): SpecSummary {
  const d = getDb()
  requireSpec(id)
  const name = patch.name.trim()
  if (!name) throw new Error('명세 이름이 비어 있습니다.')
  d.prepare('UPDATE api_specs SET name = ?, description = ? WHERE id = ?').run(name, patch.description.trim(), id)
  return listSpecs().find((s) => s.id === id)!
}

export function deleteSpec(id: string): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM api_requests WHERE spec_id = ?').run(id)
    d.prepare('DELETE FROM api_versions WHERE spec_id = ?').run(id)
    d.prepare('DELETE FROM api_specs WHERE id = ?').run(id)
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function requireSpec(id: string): { id: string; kind: InterfaceKind } {
  const row = getDb().prepare('SELECT id, kind FROM api_specs WHERE id = ?').get(id) as unknown as
    | { id: string; kind: string }
    | undefined
  if (!row) throw new Error(`명세 "${id}" 가 없습니다 — 목록에서 id 를 확인하세요.`)
  return { id: row.id, kind: row.kind as InterfaceKind }
}

// ── 요청 ──────────────────────────────────────────────────────────────────

export function listRequests(specId: string): RequestDef[] {
  const rows = getDb()
    .prepare(
      'SELECT id, name, folder, shape, params, request, responses, docs FROM api_requests WHERE spec_id = ? ORDER BY position ASC'
    )
    .all(specId) as unknown as {
    id: string
    name: string
    folder: string
    shape: string
    params: string
    request: string
    responses: string
    docs: string
  }[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    folder: r.folder,
    shape: r.shape as RequestDef['shape'],
    params: JSON.parse(r.params),
    request: JSON.parse(r.request),
    responses: JSON.parse(r.responses),
    docs: r.docs
  }))
}

/**
 * 저장 전 정합 검사 — `set` 과 `patch` 두 진입 경로가 **같은 관문**을 지난다.
 * 경로가 갈렸다고 안전선이 갈라지면 한쪽으로 들어온 잘못된 명세가 그대로 앉는다.
 */
export function assertRequestsConsistent(kind: InterfaceKind, requests: RequestDef[]): void {
  const meta = interfaceMeta(kind)
  const seen = new Set<string>()

  for (const r of requests) {
    if (!r.name.trim()) throw new Error('요청 이름이 비어 있습니다.')
    if (seen.has(r.name)) throw new Error(`요청 이름 '${r.name}' 이(가) 두 번 있습니다 — 한 명세 안에서 유일해야 합니다.`)
    seen.add(r.name)

    if (!meta.shapes.includes(r.shape)) {
      throw new Error(
        `요청 '${r.name}': ${meta.label} 에 없는 상호작용 모양 '${r.shape}' — 가능: ${meta.shapes.join(', ')}`
      )
    }

    // 그 인터페이스가 안 쓰는 칸은 존재하지 않는다(비활성이 아니라 없음 — spec shape AC-7).
    for (const key of Object.keys(r.request)) {
      if (!(meta.fields as readonly string[]).includes(key)) {
        throw new Error(
          `요청 '${r.name}': ${meta.label} 에 없는 칸 '${key}' — 쓸 수 있는 칸: ${meta.fields.join(', ')}`
        )
      }
    }

    const bad = validateParamDefs(r.params)
    if (bad.length > 0) throw new Error(`요청 '${r.name}' 파라미터 정의 오류 — ${bad[0].reason}`)

    const statuses = new Set<string>()
    for (const res of r.responses) {
      if (statuses.has(res.status)) throw new Error(`요청 '${r.name}': 상태 '${res.status}' 가 두 번 선언됐습니다.`)
      statuses.add(res.status)
    }
  }
}

/** 명세 스코프 전량 교체(tx) — 다른 명세의 행은 건드리지 않는다. */
export function replaceRequests(specId: string, requests: RequestDef[]): void {
  const d = getDb()
  const { kind } = requireSpec(specId)
  assertRequestsConsistent(kind, requests)

  d.exec('BEGIN')
  try {
    d.prepare('DELETE FROM api_requests WHERE spec_id = ?').run(specId)
    const insert = d.prepare(
      'INSERT INTO api_requests (id, spec_id, name, folder, shape, position, params, request, responses, docs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    requests.forEach((r, i) =>
      insert.run(
        r.id,
        specId,
        r.name,
        r.folder,
        r.shape,
        i,
        JSON.stringify(r.params),
        JSON.stringify(r.request),
        JSON.stringify(r.responses),
        r.docs
      )
    )
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

// ── 버전 ──────────────────────────────────────────────────────────────────

export interface VersionRecord {
  number: string
  note: string
  locked: boolean
  createdAt: string
  snapshot: SpecDef
}

export function listVersions(specId: string): VersionRecord[] {
  const rows = getDb()
    .prepare('SELECT number, note, locked, created_at, snapshot FROM api_versions WHERE spec_id = ? ORDER BY created_at DESC')
    .all(specId) as unknown as { number: string; note: string; locked: number; created_at: string; snapshot: string }[]
  return rows.map((r) => ({
    number: r.number,
    note: r.note,
    locked: r.locked === 1,
    createdAt: r.created_at,
    snapshot: JSON.parse(r.snapshot)
  }))
}

/**
 * 지금 Draft 를 그대로 잘라 버전을 만든다 — 스냅샷 본문을 **호출자가 주입하지 않는다**.
 * 주입을 허용하면 "저장된 것과 다른 것을 버전이라 부르는" 길이 열린다.
 */
export function createVersion(specId: string, number: string, note = ''): VersionRecord {
  const d = getDb()
  requireSpec(specId)
  const num = number.trim()
  if (!num) throw new Error('버전 번호가 비어 있습니다.')
  if (listVersions(specId).some((v) => v.number === num))
    throw new Error(`버전 '${num}' 은(는) 이미 있습니다 — 번호는 다시 쓰지 않습니다.`)

  const snapshot = getSpec(specId)!
  const createdAt = new Date().toISOString()
  d.prepare(
    'INSERT INTO api_versions (id, spec_id, number, note, snapshot, locked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run(`${specId}@${num}`, specId, num, note.trim(), JSON.stringify(snapshot), createdAt)
  return { number: num, note: note.trim(), locked: false, createdAt, snapshot }
}
