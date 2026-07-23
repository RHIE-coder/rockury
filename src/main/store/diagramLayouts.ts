import { getDb } from './db'

/**
 * Diagram 레이아웃 저장소(§ops-plan 2e · v2) — Console 실 ERD 의 노드 위치·뷰포트를
 * **연결(Connection)별로** 영속한다. 노드 키는 introspection 의 결정적 id(`t:<테이블명>`)라
 * 스키마 새로고침에도 매칭된다(이름이 유일). 위치/뷰포트는 JSON 문자열로 UPSERT.
 * rky 의 diagram_layouts(diagramId 키)를 Console(연결 스코프)에 맞춰 옮긴 것.
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

export interface DiagramLayoutRecord {
  connectionId: string
  positions: Record<string, NodePosition>
  viewport: Viewport | null
  updatedAt: string
}

export interface SaveLayoutInput {
  connectionId: string
  positions: Record<string, NodePosition>
  viewport?: Viewport | null
}

interface Row {
  connection_id: string
  positions: string
  viewport: string | null
  updated_at: string
}

const toRecord = (r: Row): DiagramLayoutRecord => ({
  connectionId: r.connection_id,
  positions: safeParse<Record<string, NodePosition>>(r.positions, {}),
  viewport: r.viewport ? safeParse<Viewport | null>(r.viewport, null) : null,
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
  d.prepare(
    `INSERT INTO diagram_layouts (connection_id, positions, viewport, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET
       positions = excluded.positions,
       viewport = excluded.viewport,
       updated_at = excluded.updated_at`
  ).run(
    input.connectionId,
    JSON.stringify(input.positions ?? {}),
    input.viewport ? JSON.stringify(input.viewport) : null,
    now
  )
  return getLayout(input.connectionId)!
}

export function clearLayout(connectionId: string): void {
  getDb().prepare('DELETE FROM diagram_layouts WHERE connection_id = ?').run(connectionId)
}
