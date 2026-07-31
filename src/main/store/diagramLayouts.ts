import { getDb } from './db'

/**
 * Diagram 레이아웃 저장소(§ops-plan 2e · v2) — ERD 의 노드 위치·뷰포트·**그룹**을
 * 스코프별로 영속한다. 스코프 키(`connection_id`)는 Remote = 연결 id, Design = `design:<설계 id>`.
 * 노드 키는 introspection 의 결정적 id(`t:<테이블명>`)라 스키마 새로고침에도 매칭된다(이름이 유일).
 * 위치/뷰포트/그룹은 JSON 문자열로 UPSERT.
 *
 * ⚠ 저장은 **부분 갱신**이다 — 넘기지 않은 항목은 그대로 둔다. 캔버스(위치·뷰포트)와
 * 좌측 그룹 패널(그룹)이 같은 행에 따로 쓰기 때문에, "안 넘김 = 지움"이면 서로를 지운다.
 * 뷰포트만 예외적으로 `null` 을 명시해 지울 수 있다(자동 배치).
 */
export interface NodePosition {
  x: number
  y: number
}
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/**
 * 다이어그램 그룹(레이어) 한 개.
 * ⚠ 렌더러의 `services/db/remote/diagram/group.ts` `DiagramGroup` 과 **같은 모양**이어야 한다
 * (구조가 갈라지면 IPC 로 받은 레코드를 그룹 계산에 넘기는 자리에서 타입검사가 깨진다 — 의도된 가드).
 */
export interface DiagramGroupRecord {
  id: string
  name: string
  /** 팔레트 키. 빈 문자열이면 화면이 목록 순서대로 자동 배정한다. */
  color: string
  /** 소속 테이블 id. 한 테이블은 최대 한 그룹. */
  tableIds: string[]
  collapsed: boolean
  /** 상자 기준점 — 빈 그룹·접힌 그룹의 자리. */
  x: number
  y: number
}

export interface DiagramLayoutRecord {
  connectionId: string
  positions: Record<string, NodePosition>
  viewport: Viewport | null
  groups: DiagramGroupRecord[]
  updatedAt: string
}

export interface SaveLayoutInput {
  connectionId: string
  /** 미지정이면 저장된 위치를 그대로 둔다. */
  positions?: Record<string, NodePosition>
  /** 미지정이면 그대로 두고, `null` 이면 지운다(자동 배치). */
  viewport?: Viewport | null
  /** 미지정이면 저장된 그룹을 그대로 둔다. */
  groups?: DiagramGroupRecord[]
}

interface Row {
  connection_id: string
  positions: string
  viewport: string | null
  groups: string | null
  updated_at: string
}

const toRecord = (r: Row): DiagramLayoutRecord => ({
  connectionId: r.connection_id,
  positions: safeParse<Record<string, NodePosition>>(r.positions, {}),
  viewport: r.viewport ? safeParse<Viewport | null>(r.viewport, null) : null,
  // groups 열이 없던 시절의 행은 null 로 온다 → 빈 목록(구 데이터 호환).
  groups: r.groups ? safeParse<DiagramGroupRecord[]>(r.groups, []) : [],
  updatedAt: r.updated_at
})

/** 손상된 JSON 이 저장돼 있어도 앱이 죽지 않도록 폴백. */
function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function getLayout(connectionId: string): DiagramLayoutRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM diagram_layouts WHERE connection_id = ?')
    .get(connectionId) as unknown as Row | undefined
  return row ? toRecord(row) : null
}

export function saveLayout(input: SaveLayoutInput): DiagramLayoutRecord {
  const d = getDb()
  const now = new Date().toISOString()
  // 부분 갱신 — 넘기지 않은 항목은 저장돼 있던 값을 그대로 다시 쓴다.
  const prev = getLayout(input.connectionId)
  const positions = input.positions ?? prev?.positions ?? {}
  const viewport = input.viewport === undefined ? (prev?.viewport ?? null) : input.viewport
  const groups = input.groups ?? prev?.groups ?? []
  d.prepare(
    `INSERT INTO diagram_layouts (connection_id, positions, viewport, groups, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET
       positions = excluded.positions,
       viewport = excluded.viewport,
       groups = excluded.groups,
       updated_at = excluded.updated_at`
  ).run(
    input.connectionId,
    JSON.stringify(positions),
    viewport ? JSON.stringify(viewport) : null,
    JSON.stringify(groups),
    now
  )
  return getLayout(input.connectionId)!
}

/**
 * `자동 배치` — 위치·뷰포트만 지우고 **그룹은 남긴다**(정본 §db-remote.diagram.layout AC-4).
 * 소속은 위치와 무관한 명시 멤버십이라, 자동 배치 한 번에 묶음이 흩어지면 안 된다.
 * 남길 그룹이 없으면 행 자체를 지운다(빈 행을 남기지 않는다).
 */
export function clearLayout(connectionId: string): void {
  const prev = getLayout(connectionId)
  if (!prev || prev.groups.length === 0) {
    getDb().prepare('DELETE FROM diagram_layouts WHERE connection_id = ?').run(connectionId)
    return
  }
  getDb()
    .prepare(
      `UPDATE diagram_layouts SET positions = '{}', viewport = NULL, updated_at = ?
       WHERE connection_id = ?`
    )
    .run(new Date().toISOString(), connectionId)
}
