import { randomUUID } from 'node:crypto'
import { getDb } from '../../store/db'
import type { CatalogSource } from './contract'

/**
 * Infra 저장소 접근 — 설계본·카탈로그·공급자 연결·실행 이력.
 *
 * 저장 계층은 **암호화를 하지 않는다.** 암호문을 받아 넣기만 한다(연결 정보와 같은 규약) —
 * `electron` 을 여기서 import 하면 vitest 에서 이 파일을 못 불러 저장 로직을 테스트할 수 없다.
 */

const now = (): string => new Date().toISOString()

// ---------- 카탈로그 ----------

export interface CatalogRow {
  id: string
  source: CatalogSource
  providerId: string
  schemaVersion: number
  catalogVersion: string
  /** 검증을 통과한 원문 JSON. */
  body: string
  importedAt: string | null
  approvedAt: string | null
}

interface RawCatalog {
  id: string
  source: string
  provider_id: string
  schema_version: number
  catalog_version: string
  body: string
  imported_at: string | null
  approved_at: string | null
}

const toCatalog = (r: RawCatalog): CatalogRow => ({
  id: r.id,
  source: r.source as CatalogSource,
  providerId: r.provider_id,
  schemaVersion: r.schema_version,
  catalogVersion: r.catalog_version,
  body: r.body,
  importedAt: r.imported_at,
  approvedAt: r.approved_at
})

export function listCatalogs(): CatalogRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_catalogs ORDER BY source, provider_id`)
    .all() as unknown as RawCatalog[]
  return rows.map(toCatalog)
}

export function getCatalog(id: string): CatalogRow | null {
  const row = getDb().prepare(`SELECT * FROM infra_catalogs WHERE id = ?`).get(id) as unknown as
    | RawCatalog
    | undefined
  return row ? toCatalog(row) : null
}

export interface SaveCatalogInput {
  id?: string
  source: CatalogSource
  providerId: string
  schemaVersion: number
  catalogVersion: string
  body: string
  approvedAt?: string | null
}

/**
 * 카탈로그를 넣거나 고친다.
 * **내장 카탈로그는 고칠 수 없다** — 앱이 배포와 함께 들고 오는 것이라, 고치면 다음 업데이트에
 * 조용히 되돌아간다. 사용자는 복제해서 자기 것으로 고쳐야 한다.
 */
export function saveCatalog(input: SaveCatalogInput): CatalogRow {
  const db = getDb()
  const stamp = now()
  if (input.id) {
    const existing = getCatalog(input.id)
    if (existing?.source === 'builtin') {
      throw new Error('내장 카탈로그는 고칠 수 없습니다. 복제해서 편집하세요.')
    }
  }
  const id = input.id ?? randomUUID()
  db.prepare(
    `INSERT INTO infra_catalogs
       (id, source, provider_id, schema_version, catalog_version, body, imported_at, approved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source = excluded.source,
       provider_id = excluded.provider_id,
       schema_version = excluded.schema_version,
       catalog_version = excluded.catalog_version,
       body = excluded.body,
       approved_at = excluded.approved_at,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.source,
    input.providerId,
    input.schemaVersion,
    input.catalogVersion,
    input.body,
    input.source === 'imported' ? stamp : null,
    input.approvedAt ?? null,
    stamp,
    stamp
  )
  return getCatalog(id) as CatalogRow
}

export function deleteCatalog(id: string): void {
  const existing = getCatalog(id)
  if (existing?.source === 'builtin') throw new Error('내장 카탈로그는 지울 수 없습니다.')
  getDb().prepare(`DELETE FROM infra_catalogs WHERE id = ?`).run(id)
}

// ---------- 공급자 연결 ----------

export interface ProviderRow {
  id: string
  catalogId: string
  name: string
  /** 자격증명 **암호문**. 렌더러로 나가는 레코드에는 담지 않는다. */
  credEncrypted: string
  readOnly: boolean
}

interface RawProvider {
  id: string
  catalog_id: string
  name: string
  cred_encrypted: string
  read_only: number
}

const toProvider = (r: RawProvider): ProviderRow => ({
  id: r.id,
  catalogId: r.catalog_id,
  name: r.name,
  credEncrypted: r.cred_encrypted,
  readOnly: r.read_only === 1
})

export function listProviders(): ProviderRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_providers ORDER BY created_at`)
    .all() as unknown as RawProvider[]
  return rows.map(toProvider)
}

export function getProvider(id: string): ProviderRow | null {
  const row = getDb().prepare(`SELECT * FROM infra_providers WHERE id = ?`).get(id) as unknown as
    | RawProvider
    | undefined
  return row ? toProvider(row) : null
}

export function saveProvider(input: {
  id?: string
  catalogId: string
  name: string
  credEncrypted: string
  readOnly: boolean
}): ProviderRow {
  const db = getDb()
  const stamp = now()
  const id = input.id ?? randomUUID()
  db.prepare(
    `INSERT INTO infra_providers (id, catalog_id, name, cred_encrypted, read_only, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       catalog_id = excluded.catalog_id,
       name = excluded.name,
       cred_encrypted = excluded.cred_encrypted,
       read_only = excluded.read_only,
       updated_at = excluded.updated_at`
  ).run(id, input.catalogId, input.name, input.credEncrypted, input.readOnly ? 1 : 0, stamp, stamp)
  return getProvider(id) as ProviderRow
}

/**
 * 공급자 연결을 지운다. **설계본은 건드리지 않는다** —
 * 설계는 실물과 독립적으로 존재한다(공통 불변식). 연결을 끊었다고 그림이 사라지면 안 된다.
 */
export function deleteProvider(id: string): void {
  getDb().prepare(`DELETE FROM infra_providers WHERE id = ?`).run(id)
}

// ---------- 설계본 ----------

export interface DesignRow {
  id: string
  name: string
  description: string
  /** 속한 프로젝트. null 이면 무소속 — 설계류라 프로젝트를 고르면 목록에서 숨는다. */
  projectId: string | null
}

interface DesignDbRow {
  id: string
  name: string
  description: string
  project_id: string | null
}

export function listDesigns(): DesignRow[] {
  return (
    getDb()
      .prepare(`SELECT id, name, description, project_id FROM infra_designs ORDER BY created_at`)
      .all() as unknown as DesignDbRow[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    projectId: r.project_id ?? null
  }))
}

export function createDesign(input: {
  name: string
  description?: string
  /** 만들 때 보고 있던 프로젝트. 안 주면 무소속. */
  projectId?: string | null
}): DesignRow {
  const id = randomUUID()
  const stamp = now()
  const projectId = input.projectId ?? null
  getDb()
    .prepare(
      `INSERT INTO infra_designs (id, name, description, created_at, updated_at, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.name, input.description ?? '', stamp, stamp, projectId)
  return { id, name: input.name, description: input.description ?? '', projectId }
}

export function updateDesign(
  id: string,
  patch: { name?: string; description?: string; projectId?: string | null }
): void {
  const db = getDb()
  // 소속 옮기기 — null 이 "무소속으로 되돌리기" 라서 undefined 와 갈라야 한다.
  if (patch.projectId !== undefined) {
    db.prepare(`UPDATE infra_designs SET project_id = ?, updated_at = ? WHERE id = ?`).run(
      patch.projectId,
      now(),
      id
    )
  }
  if (patch.name !== undefined) {
    db.prepare(`UPDATE infra_designs SET name = ?, updated_at = ? WHERE id = ?`).run(patch.name, now(), id)
  }
  if (patch.description !== undefined) {
    db.prepare(`UPDATE infra_designs SET description = ?, updated_at = ? WHERE id = ?`).run(
      patch.description,
      now(),
      id
    )
  }
}

export function deleteDesign(id: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM infra_edges WHERE design_id = ?`).run(id)
  db.prepare(`DELETE FROM infra_nodes WHERE design_id = ?`).run(id)
  db.prepare(`DELETE FROM infra_designs WHERE id = ?`).run(id)
}

// ---------- 노드·간선 ----------

export interface NodeRow {
  id: string
  designId: string
  typeId: string | null
  name: string
  parentId: string | null
  x: number
  y: number
  w: number
  h: number
  /** 노드 문서 JSON 원문. 읽는 쪽이 `normalizeDoc` 으로 모양을 고른다. */
  doc: string
  catalogVersion: string | null
}

interface RawNode {
  id: string
  design_id: string
  type_id: string | null
  name: string
  parent_id: string | null
  pos_x: number
  pos_y: number
  size_w: number
  size_h: number
  doc: string
  catalog_version: string | null
}

const toNode = (r: RawNode): NodeRow => ({
  id: r.id,
  designId: r.design_id,
  typeId: r.type_id,
  name: r.name,
  parentId: r.parent_id,
  x: r.pos_x,
  y: r.pos_y,
  w: r.size_w,
  h: r.size_h,
  doc: r.doc,
  catalogVersion: r.catalog_version
})

export function listNodes(designId: string): NodeRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_nodes WHERE design_id = ? ORDER BY created_at`)
    .all(designId) as unknown as RawNode[]
  return rows.map(toNode)
}

export interface EdgeRow {
  id: string
  designId: string
  sourceId: string
  targetId: string
  label: string
  kind: string
}

export function listEdges(designId: string): EdgeRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_edges WHERE design_id = ?`)
    .all(designId) as unknown as {
    id: string
    design_id: string
    source_id: string
    target_id: string
    label: string
    kind: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    designId: r.design_id,
    sourceId: r.source_id,
    targetId: r.target_id,
    label: r.label,
    kind: r.kind
  }))
}

/**
 * 설계 하나의 노드·간선을 통째로 바꾼다(설계 스코프 저장).
 *
 * 전량 교체가 아니라 **설계 하나 단위**인 이유는 DB 서비스에서 이미 배운 것과 같다 —
 * 설계 X 저장이 설계 Y 를 건드리지 않아야 화면과 에이전트가 동시에 일해도 안전하다.
 * 한 트랜잭션으로 묶어 중간에 죽어도 반쯤 지워진 설계가 남지 않게 한다.
 */
export function replaceGraph(
  designId: string,
  nodes: Omit<NodeRow, 'designId'>[],
  edges: Omit<EdgeRow, 'designId'>[]
): void {
  const db = getDb()
  const stamp = now()
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM infra_edges WHERE design_id = ?`).run(designId)
    db.prepare(`DELETE FROM infra_nodes WHERE design_id = ?`).run(designId)
    const insertNode = db.prepare(
      `INSERT INTO infra_nodes
         (id, design_id, type_id, name, parent_id, pos_x, pos_y, size_w, size_h, doc, catalog_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    nodes.forEach((n, i) =>
      insertNode.run(
        n.id,
        designId,
        n.typeId,
        n.name,
        n.parentId,
        n.x,
        n.y,
        n.w,
        n.h,
        n.doc,
        n.catalogVersion,
        // created_at 을 순서 보존용으로 쓴다 — 같은 밀리초에 여러 개가 들어가도 순서가 안 섞이게.
        `${stamp}#${String(i).padStart(6, '0')}`,
        stamp
      )
    )
    const insertEdge = db.prepare(
      `INSERT INTO infra_edges (id, design_id, source_id, target_id, label, kind) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const e of edges) insertEdge.run(e.id, designId, e.sourceId, e.targetId, e.label, e.kind)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// ---------- 실행 이력 ----------

export interface RunRow {
  id: string
  providerId: string | null
  kind: string
  cmd: string
  /** **치환 전** 인자(자격증명이 참조로 남아 있다). 비밀은 여기 들어오지 않는다. */
  args: string
  ok: boolean
  exitCode: number | null
  durationMs: number
  error: string
  ranAt: string
}

export function appendRun(input: {
  providerId?: string | null
  kind: string
  cmd: string
  /** 반드시 `display`(치환 전) 를 넘긴다 — 실행용 args 를 넘기면 비밀이 이력에 남는다. */
  displayArgs: string[]
  ok: boolean
  exitCode: number | null
  durationMs: number
  error?: string
}): void {
  getDb()
    .prepare(
      `INSERT INTO infra_runs (id, provider_id, kind, cmd, args, ok, exit_code, duration_ms, error, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.providerId ?? null,
      input.kind,
      input.cmd,
      JSON.stringify(input.displayArgs),
      input.ok ? 1 : 0,
      input.exitCode,
      input.durationMs,
      input.error ?? '',
      now()
    )
}

// ---------- 실물 스냅샷 ----------

export interface ProbeOutcomeRow {
  typeId: string
  ok: boolean
  count: number
  error: string
}

export interface ResourceRow {
  typeId: string
  externalId: string
  name: string
  status: string
  rawStatus: string
  parentExternalId: string | null
  designNodeRef: string | null
}

export interface SnapshotRow {
  id: string
  providerId: string
  takenAt: string
  ok: boolean
  error: string
  probes: ProbeOutcomeRow[]
  resources: ResourceRow[]
}

/** 공급자별로 남겨 둘 회차 수. 로컬 DB 가 무한히 부풀지 않게 오래된 것부터 지운다. */
const SNAPSHOT_KEEP = 10

/**
 * 스냅샷 한 회차를 통째로 저장한다(탐침 결과 + 읽어 온 실물).
 *
 * 일부 탐침이 실패해도 **성공한 것은 저장하고 실패한 것은 실패로 남긴다.**
 * 전부 실패로 뭉개면 멀쩡히 읽은 것까지 사라지고, 조용히 성공으로 넘기면 지도가 거짓말을 한다.
 */
export function saveSnapshot(input: {
  providerId: string
  probes: ProbeOutcomeRow[]
  resources: ResourceRow[]
}): SnapshotRow {
  const db = getDb()
  const id = randomUUID()
  const takenAt = now()
  const ok = input.probes.length > 0 && input.probes.every((p) => p.ok)

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO infra_snapshots (id, provider_id, taken_at, ok, error) VALUES (?, ?, ?, ?, ?)`
    ).run(id, input.providerId, takenAt, ok ? 1 : 0, '')

    const probe = db.prepare(
      `INSERT INTO infra_snapshot_probes (snapshot_id, type_id, ok, count, error) VALUES (?, ?, ?, ?, ?)`
    )
    for (const p of input.probes) probe.run(id, p.typeId, p.ok ? 1 : 0, p.count, p.error)

    const res = db.prepare(
      `INSERT INTO infra_resources
         (id, snapshot_id, type_id, external_id, name, status, raw_status, parent_external_id, design_node_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of input.resources) {
      res.run(
        randomUUID(),
        id,
        r.typeId,
        r.externalId,
        r.name,
        r.status,
        r.rawStatus,
        r.parentExternalId,
        r.designNodeRef
      )
    }

    // 오래된 회차 정리 — 최신 SNAPSHOT_KEEP 개만 남긴다.
    const old = db
      .prepare(
        `SELECT id FROM infra_snapshots WHERE provider_id = ? ORDER BY taken_at DESC LIMIT -1 OFFSET ?`
      )
      .all(input.providerId, SNAPSHOT_KEEP) as unknown as { id: string }[]
    for (const o of old) {
      db.prepare(`DELETE FROM infra_resources WHERE snapshot_id = ?`).run(o.id)
      db.prepare(`DELETE FROM infra_snapshot_probes WHERE snapshot_id = ?`).run(o.id)
      db.prepare(`DELETE FROM infra_snapshots WHERE id = ?`).run(o.id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return latestSnapshot(input.providerId) as SnapshotRow
}

/** 그 공급자의 가장 최근 회차. 없으면 null(= 아직 안 읽음 → 대조는 '대조 안 함'). */
export function latestSnapshot(providerId: string): SnapshotRow | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT * FROM infra_snapshots WHERE provider_id = ? ORDER BY taken_at DESC LIMIT 1`)
    .get(providerId) as unknown as
    | { id: string; provider_id: string; taken_at: string; ok: number; error: string }
    | undefined
  if (!row) return null

  const probes = db
    .prepare(`SELECT type_id, ok, count, error FROM infra_snapshot_probes WHERE snapshot_id = ?`)
    .all(row.id) as unknown as { type_id: string; ok: number; count: number; error: string }[]

  const resources = db
    .prepare(`SELECT * FROM infra_resources WHERE snapshot_id = ?`)
    .all(row.id) as unknown as {
    type_id: string
    external_id: string
    name: string
    status: string
    raw_status: string
    parent_external_id: string | null
    design_node_ref: string | null
  }[]

  return {
    id: row.id,
    providerId: row.provider_id,
    takenAt: row.taken_at,
    ok: row.ok === 1,
    error: row.error,
    probes: probes.map((p) => ({ typeId: p.type_id, ok: p.ok === 1, count: p.count, error: p.error })),
    resources: resources.map((r) => ({
      typeId: r.type_id,
      externalId: r.external_id,
      name: r.name,
      status: r.status,
      rawStatus: r.raw_status,
      parentExternalId: r.parent_external_id,
      designNodeRef: r.design_node_ref
    }))
  }
}

/** 그 공급자가 남긴 회차 수 — 정리가 도는지 확인하는 용도. */
export function countSnapshots(providerId: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM infra_snapshots WHERE provider_id = ?`)
    .get(providerId) as unknown as { c: number }
  return r.c
}

export function listRuns(limit = 50): RunRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_runs ORDER BY ran_at DESC LIMIT ?`)
    .all(limit) as unknown as {
    id: string
    provider_id: string | null
    kind: string
    cmd: string
    args: string
    ok: number
    exit_code: number | null
    duration_ms: number
    error: string
    ran_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    kind: r.kind,
    cmd: r.cmd,
    args: r.args,
    ok: r.ok === 1,
    exitCode: r.exit_code,
    durationMs: r.duration_ms,
    error: r.error,
    ranAt: r.ran_at
  }))
}

// ---------- 미들웨어 접속 (M5) ----------

/**
 * 미들웨어 접속 한 벌. **비밀은 암호문 컬럼에만 있다** — 공급자 연결과 같은 규칙이다.
 * 화면으로 나갈 때는 `MwConnectionPublic` 으로 걸러 비밀을 뺀다.
 */
export interface MwConnectionRow {
  id: string
  kind: string
  name: string
  host: string
  port: number
  username: string
  secretEncrypted: string
  options: string
}

/** 렌더러로 나가는 형태 — 암호문도 평문도 담지 않는다. */
export interface MwConnectionPublic {
  id: string
  kind: string
  name: string
  host: string
  port: number
  username: string
  /** 비밀이 채워져 있나(값은 주지 않는다). */
  hasSecret: boolean
  options: string
}

const mwRow = (r: {
  id: string
  kind: string
  name: string
  host: string
  port: number
  username: string
  secret_encrypted: string
  options: string
}): MwConnectionRow => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  host: r.host,
  port: r.port,
  username: r.username,
  secretEncrypted: r.secret_encrypted,
  options: r.options
})

export function listMwConnections(): MwConnectionRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM infra_mw_connections ORDER BY kind, name`)
    .all() as unknown as Parameters<typeof mwRow>[0][]
  return rows.map(mwRow)
}

export function getMwConnection(id: string): MwConnectionRow | null {
  const r = getDb()
    .prepare(`SELECT * FROM infra_mw_connections WHERE id = ?`)
    .get(id) as unknown as Parameters<typeof mwRow>[0] | undefined
  return r ? mwRow(r) : null
}

export function saveMwConnection(input: {
  id?: string
  kind: string
  name: string
  host: string
  port: number
  username?: string
  /** 이미 암호화된 비밀. 빈 문자열이면 **기존 값을 지우지 않고 그대로 둔다**(수정 시 재입력 강요 금지). */
  secretEncrypted?: string
  options?: string
}): MwConnectionRow {
  const id = input.id ?? randomUUID()
  const stamp = now()
  const prev = input.id ? getMwConnection(input.id) : null
  const secret = input.secretEncrypted || prev?.secretEncrypted || ''
  getDb()
    .prepare(
      `INSERT INTO infra_mw_connections
         (id, kind, name, host, port, username, secret_encrypted, options, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         host = excluded.host,
         port = excluded.port,
         username = excluded.username,
         secret_encrypted = excluded.secret_encrypted,
         options = excluded.options,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      input.kind,
      input.name,
      input.host,
      input.port,
      input.username ?? '',
      secret,
      input.options ?? '{}',
      stamp,
      stamp
    )
  return getMwConnection(id) as MwConnectionRow
}

export function deleteMwConnection(id: string): void {
  getDb().prepare(`DELETE FROM infra_mw_connections WHERE id = ?`).run(id)
}
